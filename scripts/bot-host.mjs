#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { TelegramApi, TelegramError, isSendableMedia } from './lib/tg-api.mjs';
import { chunkForTelegram } from './lib/tg-copy-code.mjs';
import { formatWorkingHeadline, formatUsageSuffix, ctxLimitFor, phaseLabelFor } from './lib/tg-progress.mjs';
import { Throttle } from './lib/tg-throttle.mjs';
import {
  BOT,
  HUMAN,
  findSeatByUsername,
  normalizePeers,
  receiveVerdict,
  resolvePolicy,
  resolvePeerUsername,
  sendVerdict,
  senderTypeOf,
} from './lib/tg-peers.mjs';
import {
  checkReceiveBounds,
  checkSendBounds,
  deadLetter,
  decodeEnvelope,
  emptyLedger,
  encodeEnvelope,
  proposalLine,
} from './lib/tg-handoff.mjs';
import {
  TURNS_KINDS,
  chainIdOf,
  delegationPrompt,
  readAgreement,
  COLLAB_DEFAULTS as HANDOFF_DEFAULTS,
} from './lib/b2b-collab.mjs';
import {
  sessionKey,
  projectIdForWorkspace,
  resolveSession,
  getSession,
  setTx,
  setWorkView,
  handoffSession,
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
import { createReasoningReducer } from './lib/reasoning-compress.mjs';
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
import { issueToken } from './tui-gateway.mjs';
import { KNOWN_HOSTS, workerStatus, isLocalHost, machineLabel } from './lib/worker-presence.mjs';
import { getBlockedLocation, setBlockedLocation, clearBlockedLocation } from './lib/location-state.mjs';
import { appendRow, retrieve } from './lib/memory-stores.mjs';
import { enqueueJob, awaitJob, requeueJob, getJob, DEFAULT_LEASE_MS } from './lib/worker-jobs.mjs';
import { preflightWorkerTurn, classifyWorkerFailure, retryDelayMs, preflightSummary, relayUrl } from './lib/swap-guards.mjs';
import { routeState, routeFor, armRoute, confirmRoute, rollbackRoute, validateCanaryResult, failedRouteReason } from './lib/worker-routing.mjs';
import { acquirePollerLease, releasePollerLease, renewPollerLease } from './lib/poller-lease.mjs';
import { buildPack, packWithContents } from './lib/swap-pack.mjs';
import { runCline, CLINE_THINKING_LEVELS } from './lib/agent-cline.mjs';
import { tuiSurfaceFor as tuiSurface, latestClineSessionId, canOpenSharedTui } from './lib/tui-surface.mjs';
import { runGemini } from './lib/agent-gemini.mjs';
import { parseRetryHintMs } from './lib/tool-allowance-ping.mjs';
import { parsePermissionCallback, startPermissionWatch, stopPermissionWatch } from './lib/permission-bridge.mjs';
import { recordError, noteHealthy, recordRecoveryAttempt, classifyErrorKind, evaluateRecovery } from './lib/error-log.mjs';
import {
  parseModelRef,
  buildFreeModelList,
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
  withCatalogLanes,
  entriesFromLanes,
  effectiveProviderOf,
  planCodeForLane,
  canonicalAllowanceLanes,
  groupRowsByTier,
  rowWidth,
  headingWidth,
  shortModelName,
  buildAllowanceTextForBots,
  nextUsableLane,
  formatResetIn,
  renderFreeLaneTableHtml,
  ensureBotLedger,
  stampDepleted,
  freemodelRefToRoute,
  routeCandidates,
  liveRecForRoutes,
  defaultResetLabel,
  usableTurnLanes,
  projectLanes,
  soonestResetAmongDepleted,
  isConnectionFailure,
  isHardModelFailure,
  stampCooldown,
  CONNECTION_FAILED_COOLDOWN_MS,
  HARD_MODEL_FAILURE_COOLDOWN_MS,
  freemodelDisplayTier,
  sortFreemodelTierRows,
  freemodelRatingOf,
  poolCommand,
  poolForCommand,
  poolOfLane,
  poolOfRef,
  poolOfRow,
  poolRows,
  poolDisplayName,
} from './lib/free-lanes.mjs';
import { recordTurn, storeStatus, flushTurns } from './lib/turn-store.mjs';
import { ensureTurnLog, makeSends, writerFor } from './lib/google-writer.mjs';
// R-16: the score on a button is the bakeoff ledger's own verdict, and the tier
// is the catalog's. Both live in the catalogs, so there is no ratings table here
// to drift from them. A model with no ledger row renders "unranked".
import { scoreLabelFor, benchmarkLabel, walkTierRank, tierForModel } from './lib/free-catalogs.mjs';
import { loadRegistry, getBot, resolveToken, resolveRegistryPath, normalizeConfig } from './lib/registry.mjs';
import {
  loadRoles,
  resolveRole,
  applyRoleToRow,
  describeRoleChange,
  validateRoleShape,
  validateRoleTarget,
  defaultCatalogPath,
} from './lib/bot-roles.mjs';
import {
  parseCommand,
  resolveCommandName,
  isKnownCommand,
  greetingReply,
  normalizeSkillCommand,
  isAddressedToUs,
  resolveGroupAddressing,
  recordActiveThread,
  clearActiveThread,
  chatKind,
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
  formatUsage,
  POOL_POINTER,
  POOL_EXIT_NOTE,
  extractMedia,
  extractCodeBlocks,
} from './lib/commands.mjs';
import {
  buildStatusSnapshot,
  formatStatusPlain,
} from './lib/bot-status.mjs';
import {
  compactSession,
  formatCompactEmpty,
  formatCompactFailure,
  formatCompactReceipt,
} from './lib/compact-session.mjs';
import {
  fleetChatStatus,
  formatFleetStatusTable,
} from './lib/fleet-status.mjs';
import {
  selectInboundMedia,
  sanitizeFileName,
  inboundMediaDir,
  buildInboundPrompt,
} from './lib/inbound-media.mjs';
import { claimFiles, releaseFiles, listLocks, extractFiles } from './lib/file-locks.mjs';
import {
  KNOWN_PROJECTS,
  bindRegistryBot,
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
import { runPmCommand } from './lib/pm-run.mjs';
import { runFullCouncil, runCouncilStage, getCouncilStatus } from './council-runner.mjs';
import { classifyHealthGroupTurn, answerHealthGroup, dedicatedHealthRoleIds, readHealthVerify, healthRoleOf, HEALTH_SEAT_IDS } from './lib/health-group.mjs';
import { gateFromArtifact } from './lib/health/docs.mjs';
import {
  answerTaxGroup,
  classifyTaxGroupTurn,
  dedicatedTaxRoleIds,
  forgetTaxGroup,
  isTaxGroupChat,
  readTaxSnapshot,
  rememberTaxGroup,
  taxDeskBotId,
  taxRoleOf,
  TAX_PROJECT_ID,
  TAX_SEAT_IDS,
} from './lib/tax-group.mjs';
// The Personal Health Coach's data loop. `/health` is deliberately not gated on
// the chat's active project: the command names its own project, so a verify can
// be run from any chat, and the reply says which one it read.
import { runHealthVerify, runHealthIngest, runHealthRefresh, runHealthAnalyze, getHealthStatus, formatVerifyText, formatStatusText, formatRefreshText, formatAnalyzeText, runHealthDoctor, formatDoctorText, runHealthResearch, formatResearchText } from './health-runner.mjs';
// "Can a seat actually run?" — the readiness check reads the context a seat
// would be handed plus this host's credentials, and reports what is missing
// instead of letting a turn start on an empty context.
import { checkHealthReadiness, formatReadinessText } from './lib/health/readiness.mjs';
import { runTaxCommand, runTaxSweep, runTaxStatus, runTaxVerify, TAX_SUBS } from './tax-runner.mjs';

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

/**
 * Store flush loop (G-1). Runs on its own timer, never in the message path.
 *
 * A turn spools and returns; this drains the spool in the background. The interval
 * is deliberately unhurried: Drive and Sheets both rate-limit, and a queue that
 * retries harder than the API forgives turns a slow provider into data loss.
 */
function startStoreFlusher(config) {
  const tick = async () => {
    if (storeFlushBusy) return;
    storeFlushBusy = true;
    try {
      const status = storeStatus(config.id);
      if (!status.pending) return;
      const writer = await writerFor(process.env);
      if (!writer.ok) {
        storeFlushNote = writer.reason || 'store not ready';
        return;
      }
      const report = await flushTurns(config.id, makeSends(writer, process.env));
      storeFlushNote = report.failed
        ? `${report.sent} sent, ${report.failed} failed — ${report.firstError}`
        : `${report.sent} sent`;
      if (report.sent) storeFlushNote = `${storeFlushNote} at ${new Date().toISOString().slice(11, 19)}Z`;
    } catch (err) {
      storeFlushNote = `flush error: ${String(err && err.message ? err.message : err).slice(0, 120)}`;
    } finally {
      storeFlushBusy = false;
    }
  };
  const timer = setInterval(tick, STORE_FLUSH_MS);
  timer.unref?.();
  return { timer, tick };
}

let storeFlushBusy = false;
let storeFlushNote = '';
const STORE_FLUSH_MS = Number(process.env.GOOGLE_STORE_FLUSH_MS || 120000);

function stateDir(id) {
  const dir = path.join(HOME, '.local', 'state', 'bot-host', id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Where a refused handoff is written when it cannot be delivered.
 *
 * This used to default to `<cwd>/specs/bot-handoff-dead-letter`, which put the
 * record of a refusal inside whichever tree the process happened to be started
 * from: the live box's serving clone had accumulated 17 untracked files that
 * way (measured 2026-10-08) and every deploy read as dirty for a reason that
 * had nothing to do with the code. A dead letter is state, so it belongs under
 * the state root beside the ledger — and the root stays the CALLER's, so a test
 * still cannot write into a live seat's state dir.
 */
function deadLetterRoot(botDir) {
  return process.env.TG_DEAD_LETTER_DIR || path.join(botDir, 'dead-letter');
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
// Cline session ids are NOT opencode session ids. They look nothing alike
// (`ses_…` vs `<epoch-ms>_<rand>`) and only one of them is valid for the tool
// that produced it, so they get their own map rather than sharing `sessions.json`
// — a cline id in that map would be handed straight to `opencode run --session`.
const loadClineSessions = (id) => loadMap(id, 'cline-sessions.json');
const saveClineSessions = (id, sessions) => saveMap(id, 'cline-sessions.json', sessions);

/**
 * The opencode session a chat is on, but only if it belongs to the workspace
 * this turn runs in. Cline is excluded on purpose: its ids are not opencode
 * ids, and it keeps its own map.
 *
 * A chat had exactly one session row, and nothing in it said which project that
 * session belonged to. So switching project left the row pointing at the old
 * project's conversation: the TUI dutifully attached it (the pane showed a PIP
 * Defense Council session while the bot answered from Health-tracker), and the
 * bot's own turn passed no session at all, so it silently started or picked a
 * different one. The two drifted apart and neither noticed.
 *
 * The scope is stored beside the id as `<workspace>\u0000<sessionId>`, so a row
 * written before this change (a bare id, no scope) reads as belonging to
 * nothing and is therefore dropped — the honest reading: we do not know where it
 * came from, and a wrong session is worse than a fresh one.
 */
const SESSION_SCOPE_SEP = '\u0000';

function scopeSessionId(workspace, sessionId) {
  const ws = String(workspace || '').trim();
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  // No workspace means we cannot scope it. Store the id alone so the next read
  // treats it as unscoped rather than silently binding it to wherever.
  return ws ? `${ws}${SESSION_SCOPE_SEP}${sid}` : sid;
}

function unscopeSessionId(scoped) {
  const raw = String(scoped || '');
  const cut = raw.indexOf(SESSION_SCOPE_SEP);
  return cut === -1 ? null : { workspace: raw.slice(0, cut), sessionId: raw.slice(cut + 1) };
}

/** The session id for this chat in this workspace, or null when there is none. */
export function sessionForWorkspace(sessions, chatId, workspace) {
  const row = sessions?.get?.(String(chatId)) ?? sessions?.get?.(chatId);
  const parts = unscopeSessionId(row);
  if (!parts) return null;
  // Exact match only. A near-miss (same project, moved directory) is a
  // different conversation to the tool, and reusing it is the bug this guards.
  return parts.workspace === String(workspace || '') ? parts.sessionId : null;
}

/** Record the chat's session for a workspace, replacing any other workspace's. */
export function bindSessionForWorkspace(sessions, chatId, workspace, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  sessions.set(String(chatId), scopeSessionId(workspace, sid));
  return true;
}
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
    // The pool a pool command put this chat in, or null for the unconstrained
    // default. It rides on `eff` rather than a second lookup, because the walk,
    // the picker body and the tap notices must all read the one value.
    pool: p.pool || null,
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

/**
 * Chat-facing lane name: the routing ref without its surface prefix and
 * without internal variant markers. `cline:cline-free/deepseek-v4.1-flash`
 * → `deepseek-v4.1-flash`, `tokenharbor/deepseek-v4.1-flash:free` →
 * `tokenharbor/deepseek-v4.1-flash` (the vendor dir stays because the
 * headline provider for that bar reads OpenCode), `opencode/space-bunny-free`
 * → `space-bunny-free`. `opencode-go/space-bunny-free` keeps its prefix:
 * it is a different free pool from `opencode/space-bunny-free`, and stripping
 * both to `space-bunny-free` made a failover line read "X is depleted — ran
 * on X instead". Plain ids pass through untouched, so unit-test
 * lanes like `m1` render exactly as before. Display only — routing still
 * uses the full ref.
 */
export function chatLaneName(ref) {
  const r = freemodelRefToRoute(ref || '');
  let s = String(r.model || ref || '').trim();
  s = s.replace(/^cline-free\//i, '').replace(/:free$/i, '');
  if (r.provider && s.toLowerCase().startsWith(`${String(r.provider).toLowerCase()}/`)) {
    const rest = s.slice(String(r.provider).length + 1);
    const provider = String(r.provider || '').toLowerCase();
    // The prefixes that disambiguate distinct pools stay. tokenharbor shares
    // one bar with its opencode twin but reads under the OpenCode headline,
    // so the dir carries the meaning; opencode-go is a separate pool from
    // opencode (live 2026-10-04: one depleted while the other answered).
    if (!/^tokenharbor\//i.test(s) && provider !== 'opencode-go') s = rest;
  }
  return s || String(ref || '');
}

/**
 * A bare `PONG` is not an answer. Connectivity pings ("reply PONG") circulate
 * on the shared opencode service (TUI-side checks, lane watchers), and a turn
 * resuming a session that last saw one can come back with a lone `PONG` to a
 * prompt that never asked for it — which the chat then receives as the reply.
 * True only for the bare word (optional trailing punctuation); a prompt that
 * actually requests it alongside a request verb (reply/say/ping/…) is
 * honoured. Deliberately pong-only: a bare `ok` can be a legitimate
 * acknowledgement, and the failover sensors use it as their success fixture.
 */
export function isUnpromptedProbeEcho(text, prompt) {
  const t = String(text ?? '').trim().toLowerCase().replace(/[!.\s]+$/, '');
  if (t !== 'pong') return false;
  const p = String(prompt ?? '');
  if (p.length <= 120 && /\bpong\b/i.test(p)
    && /\b(reply|say|send|respond|repeat|ping|test|probe|answer|echo)\b/i.test(p)) return false;
  return true;
}

/**
 * Which tool the /tui terminal should launch for this chat, and what it may
 * claim. The table itself lives in lib/tui-surface.mjs so the bot, the attach
 * script and the sensors cannot disagree about it.
 */
export function tuiSurfaceFor(model) {
  return tuiSurface(model);
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
      message: `${head}.${hint ? ` ${hint}` : ''} Pick another lane from /model_free or wait for reset.`,
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

/**
 * The variant the next `-m` argument may carry (plan/TG_TOOL_SURFACE.md M3).
 *
 * A stored level the model does not offer must never reach the child argv:
 * `ring-2.6-1t-free#xhigh` dies as "Invalid model reference" and burns the
 * whole failover walk (live 2026-10-04: three lanes down before gemini
 * answered). Models with no variants run bare — same shape as the Cline
 * branch, which only forwards levels in CLINE_THINKING_LEVELS.
 */
export function pickOfferedVariant(variant, offered) {
  if (!variant) return undefined;
  return Array.isArray(offered) && offered.includes(variant) ? variant : undefined;
}

/**
 * Context window of a lane ref, from the OpenCode model catalog.
 *
 * A legacy `gemini:` ref runs through the direct Gemini API (the OpenCode
 * `google/` provider needs a credential some hosts do not have wired) but
 * names the SAME model the catalog knows as `google/…` — `GEMINI_TO_OPENCODE`
 * is that mapping and `/model` migration already uses it. Without the hop the
 * lookup missed, so `formatUsage` printed its no-limit fallback (`ctx 539
 * tokens`) and the chat lost the `(16%)` share of the window for a lane whose
 * window the catalog carries (live 2026-10-06: a turn that failed over to
 * `gemini:gemini/gemini-3.8-flash`). Exported for the unit sensor.
 */
export async function getContextLimit(config, caches, modelId) {
  if (!caches.verbose) {
    caches.verbose = parseModelsVerbose(
      await listModelsVerbose({ opencodeBin: config.agent.opencodeBin, env: opencodeEnv(config) }),
    );
  }
  const catalogLimit = (id) => caches.verbose.find((m) => m.id === id)?.context || 0;
  const direct = catalogLimit(modelId);
  if (direct) return direct;
  const legacy = GEMINI_TO_OPENCODE[parseModelRef(modelId).id];
  return legacy ? catalogLimit(legacy) : 0;
}

/**
 * Context windows for the lanes a turn may walk, keyed by the lane ref, from
 * the catalog the answer footer already reads.
 *
 * The headline's static map (`ctxLimitFor`) knows a handful of free lanes, so
 * every other lane rendered a bare token count — no share of its window — even
 * when the window is catalog truth (live 2026-10-06: a turn that failed over
 * to `gemini:gemini/gemini-3.8-flash` ended with a bare `- 31.9K` and a
 * `ctx 539 tokens` footer, on a model whose window the catalog carries).
 * Best-effort by design: a lane the catalog cannot resolve is simply absent,
 * and the headline keeps its old fallback rather than inventing a percentage.
 */
export async function laneContextLimits(config, caches, models = []) {
  const out = new Map();
  for (const model of Array.isArray(models) ? models : []) {
    if (!model || out.has(model)) continue;
    try {
      const limit = await getContextLimit(config, caches, model);
      if (limit > 0) out.set(model, limit);
    } catch {
      // an unknown lane is not an error — it just shows the bare count
    }
  }
  return out;
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
 * Boot warmup for the turn path (plan/TG_TOOL_SURFACE.md M1).
 *
 * The first turn after a restart paid ~3s building the free-model list
 * inside the send→session-row budget (M1 proof runs measured 6.8s/7.4s
 * against a 5s budget; buildFreeModelList alone is ~2.6s cold on this host).
 * These are the same zero-burn local reads the turn would do anyway
 * (catalog/auth files, `--version` probes) — warming them once at boot
 * moves the cost out of the message path. Best-effort: the turn rebuilds
 * whatever is still missing.
 */
export async function warmTurnCaches(config, caches) {
  try {
    hostReadiness(caches, config?.id);
  } catch {
    /* the turn path recomputes this */
  }
  try {
    await getFreeModels(caches, config);
  } catch {
    /* the turn path rebuilds this */
  }
  // The variant gate on the turn path (pickOfferedVariant) reads the verbose
  // catalog: warm it here so the first turn after boot does not pay a
  // `models --verbose` spawn inside the send→session-row budget.
  try {
    if (!caches.verbose) {
      caches.verbose = parseModelsVerbose(
        await listModelsVerbose({ opencodeBin: config?.agent?.opencodeBin, env: opencodeEnv(config) }),
      );
    }
  } catch {
    /* getVariants rebuilds this */
  }
  return caches;
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
export function stampLaneCooldown({ botId, model, errText, kind = 'connection-failed', now = Date.now() } = {}) {
  try {
    const { provider, model: m } = freemodelRefToRoute(model || '');
    if (!provider || !m) return null;
    const { dir } = ensureBotLedger(botId || 'default');
    const stamped = stampCooldown({ stateDir: dir, provider, model: m, errText, kind, now });
    if (stamped.stamped) {
      const until = Date.now() + (kind === 'model-unavailable' ? HARD_MODEL_FAILURE_COOLDOWN_MS : CONNECTION_FAILED_COOLDOWN_MS);
      console.log(`[${botId}] ${kind} cooldown on ${provider}/${m} until ${new Date(until).toISOString()}`);
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
export async function runOnWorker({ host, prompt, model, project = '', role = '', workspace = '', sessionId = '', envMode = 'project', timeoutMs = 900000, canary = false, relay = '', preflightFull = false, attempts = 3, packRoot = '', relayToken = process.env.WORKER_RELAY_TOKEN || '', onJob = null, onEvent = null } = {}) {
  // Guard 4: presence → relay → workspace → session, each named, first failure
  // wins, so a bad target is caught before a job exists — not after a worker
  // has claimed it.
  const relayHeaders = relayToken ? { authorization: `Bearer ${relayToken}` } : {};
  const preflight = await preflightWorkerTurn({ host, workspace, sessionId, relay, full: preflightFull, token: relayToken });
  if (!preflight.ok) {
    console.log(`[${host}] preflight failed at ${preflight.failed}: ${preflight.reason}`);
    return { text: '', code: 1, model, error: `preflight failed (${preflight.failed}): ${preflight.reason}`, remote: true, preflight, failed: preflight.failed };
  }
  // Guard 9: on a swap the files this conversation has been editing travel
  // with it, so the worker does not run the turn against its own copy.
  let packId = '';
  // QS-4: the manifest travels back with the result so the turn can say which
  // pack path wrote it (disk-pack / lane-summary / summary-skipped).
  let packManifest = null;
  if (packRoot) {
    const built = buildPack(packRoot);
    if (!built.ok) {
      console.log(`[${host}] pack refused: ${built.reason} (the turn runs without it)`);
      packManifest = { ok: false, reason: built.reason };
    } else {
      const payload = packWithContents(built);
      if (!payload.ok) console.log(`[${host}] pack not built: ${payload.reason} (the turn runs without it)`);
      else {
        const res = await fetch(`${relayUrl({ url: relay })}/packs/${encodeURIComponent(payload.id)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...relayHeaders },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          packId = payload.id;
          packManifest = {
            ok: true, id: payload.id, root: packRoot, source: payload.source,
            files: payload.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
            totalBytes: payload.totalBytes, createdAt: payload.createdAt,
          };
          console.log(`[${host}] pack ${payload.id} uploaded (${payload.files.length} file(s), ${payload.totalBytes} bytes)`);
        } else {
          console.log(`[${host}] pack upload refused with ${res.status} (the turn runs without it)`);
        }
      }
    }
  }
  const job = enqueueJob({ host, prompt, model, project, role, workspace, sessionId, envMode, canary, packId });
  console.log(`[${host}] handed ${job.id} to the connected worker${sessionId ? ` (session ${sessionId})` : ''}${canary ? ' (canary)' : ''}`);
  // Let the caller register the run and stream live events (TG
  // headline + observer) while the turn runs elsewhere.
  if (typeof onJob === 'function') {
    try { onJob({ jobId: job.id }); } catch {
      // registration must never break the hand-off
    }
  }
  const deadline = Date.now() + timeoutMs;
  const budget = Math.max(1000, Math.ceil(timeoutMs / Math.max(1, attempts)));
  let lastError = `worker ${host} did not answer in time`;
  let lastFailed = 'timeout';
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const done = await awaitJobWithEventPump(job.id, {
      timeoutMs: Math.min(budget, remaining),
      relay,
      relayToken,
      ...(typeof onEvent === 'function' ? { onEvent } : {}),
    });
    if (done?.result) {
      return { ...done.result, remote: true, jobId: job.id, ledger: done.result.ledger || null, attempts: attempt, packManifest };
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
/**
 * Record that a lane switch was attempted as a recovery.
 *
 * The failover walk already moves the turn; what was missing is the ledger
 * entry saying so. Without this call the error log shows open→closed with no
 * trace of how the conversation survived — a recovery nobody can audit. With
 * it, the row parks in `recovering` naming the evaluated rule, and the next
 * clean run on either lane closes it via noteHealthy. Bookkeeping must never
 * break failover, so every failure mode here returns null instead of throwing.
 */
export function noteLaneSwitch({ from = '', to = '', reason = '', botId = '', home = os.homedir() } = {}) {
  try {
    const logPath = process.env.BOT_ERROR_LOG === '0'
      ? null
      : (process.env.BOT_ERROR_LOG || path.join(home, '.hermes', 'bot-error-log.json'));
    const kind = classifyErrorKind(String(reason || 'error'));
    const rec = recordError({ kind, lane: from, bot: botId, hint: String(reason || '').slice(0, 200) }, logPath);
    if (!rec) return null;
    const { action: rule } = evaluateRecovery(rec);
    return recordRecoveryAttempt(rec.id, { rule, ok: false, note: `switched to ${to}` }, logPath);
  } catch {
    return null;
  }
}

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
    // Keyed Gemini lanes stamp like any other lane: the key carries its own
    // quota (vendor countdown or default TTL) and the host-account mirror
    // shares it, so a spent key is skipped instead of re-burned every turn.
    if (!provider || !model) return null;
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
 * the KEYBOARD, and the message carries no second copy of it. This command was
 * doing the opposite, twice over: 49 bullets in the body, the same 49 as buttons,
 * then a footer repeating the counts — a second list of the same models in a
 * different wording, with catalog labels on one side and the table's labels on
 * the other, so /freemodel and /allowance showed the same models as two different
 * lists. Trimming that to a header plus counts did not fix it either: the text was
 * still a summary of the keyboard sitting above it, and on a phone it was six
 * lines of it before the first button.
 *
 * So the models ARE the buttons and nothing else: one row each, labelled exactly
 * as /allowance labels them, ❌ when the row cannot be used, and still tappable so
 * a tap can answer "depleted, pick this instead" the way the router's do. The
 * message body is one zero-width character, because Telegram rejects an empty
 * `sendMessage` and the keyboard has no message of its own to hang off. Counts
 * live on `returns.usable` / `returns.unusable` for callers that want them.
 * `returns.buttons` is built from the same projection /allowance renders, so the
 * two commands cannot disagree about a row.
 */

/**
 * The /freemodel message body: one WORD JOINER (U+2060).
 *
 * Telegram rejects `sendMessage` with an empty string ("Bad Request: message text
 * is non-empty"), and an inline keyboard has to hang off a message — so the
 * message needs one character that renders as nothing. Which characters count is
 * decided by the API, not by what looks blank, and the obvious ones are wrong.
 * Measured against the live API on 2026-10-02, each sent and deleted:
 *
 *   " " space                          REJECTED  text must be non-empty
 *   U+200B ZERO WIDTH SPACE            REJECTED  text must be non-empty
 *   U+FEFF ZERO WIDTH NO-BREAK SPACE   REJECTED  text must be non-empty
 *   U+2800 BRAILLE PATTERN BLANK       REJECTED  text must be non-empty
 *   U+3164 HANGUL FILLER               REJECTED  MESSAGE_EMPTY
 *   U+00AD SOFT HYPHEN                 accepted
 *   U+034F COMBINING GRAPHEME JOINER   accepted
 *   U+FFA0 HALFWIDTH HANGUL FILLER     accepted (but it RENDERS as a blank box)
 *   U+2060 WORD JOINER                 accepted, and renders as nothing
 *
 * U+200B was shipped here first and broke /freemodel outright: every reply came
 * back 400 and the reader saw no keyboard and no message. U+2060 is a zero-width
 * format character, so it survives the API's emptiness check and draws nothing.
 * Exported so the sensor can assert the body is the keyboard's alone — and named,
 * so the next person does not go re-derive this from guesswork.
 */
export const FREEMODEL_EMPTY_BODY = '\u2060';

/**
 * A depleted lane's reset as prose.
 *
 * `-` and `—` are the table's placeholders for "no timestamp known", and both
 * formats printed them as if they were a duration: the tap notice read `That
 * lane is depleted (reset in -)` while the table row right below it carried a
 * real countdown (live 2026-10-06). Unknown says so instead of inventing a
 * number, and the value itself now comes from the projection's own reset, so the
 * notice and the row read the same number.
 */
export function resetInBit(resetIn) {
  const value = String(resetIn ?? '').trim();
  if (!value || /^[-—–]+$/.test(value)) return 'reset time unknown';
  return `reset in ${value}`;
}

/**
 * One line per provider whose lanes this host cannot run, and why.
 *
 * `/allowance` already does this: a row whose provider has no credential on this
 * host leaves the table and is listed underneath with the variable it needs.
 * `/freemodel` dropped the same rows and said nothing at all — so on a host whose
 * `cline` binary is missing or not signed in, Cline's entire free set disappeared
 * from the keyboard with no way to tell "this model does not exist" from "this
 * host cannot run it" (operator, 2026-10-07: "I still can't see Muse from Cline",
 * while Cline's own catalog lists `muse-spark-1.3-contributor` as free).
 *
 * The count and the reason are the two facts the reader needs, and both come off
 * the row the projection already built — nothing is inferred here, and no model is
 * promised: the note says the lanes are not on this host, which is what is true.
 */
export function blockedProviderLines(rows) {
  const byProvider = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const provider = String(r.provider || r.lane?.provider || r.effectiveProvider || '').toLowerCase();
    if (!provider) continue;
    const entry = byProvider.get(provider) || { provider, count: 0, reason: '' };
    entry.count += 1;
    const reason = String(r.reason || '').trim();
    if (reason && !entry.reason) entry.reason = reason;
    byProvider.set(provider, entry);
  }
  // The names the reader sees everywhere else: "Token Harbor" and "Cloudflare" are
  // two words and "tokenharbor" is one, so a bare capitalise printed "Tokenharbor".
  const DISPLAY_NAME = {
    tokenharbor: 'Token Harbor',
    cloudflare: 'Cloudflare',
    opencode: 'OpenCode',
    freebuff: 'Freebuff',
    gemini: 'Gemini',
    cline: 'Cline',
  };
  const named = (p) => DISPLAY_NAME[p] || p.charAt(0).toUpperCase() + p.slice(1);
  const lines = [];
  for (const e of byProvider.values()) {
    const count = `${e.count} free lane${e.count === 1 ? '' : 's'}`;
    lines.push(`${named(e.provider)}: ${count} not on this host${e.reason ? ` — ${e.reason}` : ''}`);
  }
  return lines;
}

/**
 * The two prose lines of a depleted-tap answer; the refreshed allowance table
 * is appended by the caller.
 *
 * The "Next up" lane is the table's OWN picker (`nextUsableLane`), and the line
 * is worded exactly like the table's own "Next up" line — so one reply cannot
 * name two different lanes, and it never names a lane the table does not show
 * (live 2026-10-06: the notice offered a catalog-only lane while the table below
 * it offered a Cloudflare one).
 */
export function depletedLaneProse({ label = '', resetIn = '', next = null } = {}) {
  const nextBit = next
    ? `Next up: ${shortModelName(next)} · ${planCodeForLane(next)} · ${next.model}`
    : 'Next up: (no free lane available — use paid / wait for reset)';
  // The lane the user tapped is named. "That lane is depleted" left the reader to
  // scroll the table it appends to find which row they had pressed.
  const name = String(label || '').trim();
  return `${name ? `${name} is` : 'That lane is'} depleted (${resetInBit(resetIn)}).\n${nextBit}`;
}

/**
 * The one honest line a pool keyboard carries in its body.
 *
 * A keyboard cannot show a heading when it has a single group, and with one pool
 * it usually has one, so without this the reader cannot tell which list they are
 * looking at or what a quota hit will do to the chat. It names the pool, what is
 * on this host, what is usable, and the way out — which is what decision D2 costs
 * the reader who only wanted to look. The no-pool path never calls this: the body
 * is the keyboard alone, exactly as before.
 */
function poolNoteLines({ pool, location, total, usable, soonest = '' } = {}) {
  const loc = String(location || 'vps');
  const name = poolDisplayName(pool, loc);
  const move = pool === 'go'
    ? 'the Go plan is paid, so this lane never moves on its own'
    : 'a quota hit moves inside this pool only';
  if (!total) {
    return [`${name} — no lane of this pool is on ${loc} right now${soonest ? `; soonest reset in ${soonest}` : ''}. ${move}. ${POOL_EXIT_NOTE}`];
  }
  const out = [`${name} · ${total} lane${total === 1 ? '' : 's'} on ${loc} · ${usable} usable — ${move}. ${POOL_EXIT_NOTE}`];
  if (!usable) out.push(`Nothing in this pool is usable right now${soonest ? ` — soonest reset in ${soonest}` : ''}.`);
  return out;
}

/**
 * The soonest reset held by one pool's own rows, as a countdown.
 *
 * An exhausted pool has to name ITS next lane, never the other pool's — a global
 * "soonest" would offer a coding reset to a chat that asked to stay on light, and
 * that is the substitution the pools exist to remove. Read off the rows the
 * caller already built; nothing is fetched here.
 */
function soonestPoolReset(rows, pool, now = Date.now()) {
  let best = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || poolOfRow(r) !== pool) continue;
    const at = Number(r.resetAt) || Date.parse(String(r.resetIn || '')) || null;
    if (!Number.isFinite(at) || at === null) continue;
    if (best === null || at < best) best = at;
  }
  return best === null ? '' : formatResetIn(best, now);
}

export function formatFreemodelWithDepletion(entries, annotated, { current, location, canonical = null, tableLanes = [], pool = null } = {}) {
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
  // Within each tier group the rows are ordered for use, not for storage:
  // usable first by rating (benchmark AA desc, catalog rank asc, pref asc),
  // then unusable by earliest reset. The turn's same-tier failover walks this
  // same order, so the list and the failover cannot disagree.
  // Three commands, three FILTERS of the one list: the pool narrows the canonical
  // rows before they are grouped, so the keyboard, the counts and the walk read the
  // same subset of the same projection. A pool never gets a row list of its own —
  // that is the QS-8 failure with a second name.
  const canonicalRows = pool ? poolRows(canonical || [], pool) : (canonical || []);
  const tierGroups = groupRowsByTier(canonicalRows).map((g) => ({ ...g, rows: sortFreemodelTierRows(g.rows) }));
  const rows = tierGroups.flatMap((g) => g.rows);
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
    // The same pool test the canonical rows took: a catalog-only row the fold
    // missed is still a row of one pool, and letting it through unfiltered is how
    // a keyboard grows a second membership in the one list.
    if (pool && poolOfRow(v) !== pool) continue;
    const m = String(v.lane?.model || v.ref || v.label || '').toLowerCase().split('/').filter(Boolean).pop();
    if (m && !inTable.has(m)) rows.push(v);
  }
  // A lane whose provider has no credential on this host leaves the count, the same
  // way /allowance drops it from its table and names the variable underneath. It was
  // six rows here, which is why the two commands disagreed about the total even with
  // one canonical list.
  // The blocked rows are read off the ANNOTATED union, not off `rows`: the canonical
  // list this list is built from has already dropped them (it skips a needsSetup
  // verdict), so they arrive here only as verdicts. What marks one is the same
  // formula the projection used to clear `selectable` (projectLanes: selectable =
  // !ended && !depleted && !terminalOnly && !needsSetup) read backwards — with the
  // other four flags false and selectable false, the missing one can only be the
  // setup verdict. That is exact, not a guess at the reason text, and it does not
  // need `needsSetup` to survive the annotation. Deduped by ref, because the same
  // lane arrives from both the catalog side and the table side.
  const setupBlocked = (r) => Boolean(r)
    && r.selectable === false && !r.depleted && !r.ended && !r.terminalOnly && !r.needsSetup;
  const blockedByRef = new Map();
  for (const r of [...(annotated || []), ...rows]) {
    if (!setupBlocked(r)) continue;
    if (String(r.ref || '').startsWith('pending:')) continue;
    if (pool && poolOfRow(r) !== pool) continue;
    const key = String(r.ref || r.lane?.model || r.model || '');
    if (key && !blockedByRef.has(key)) blockedByRef.set(key, r);
  }
  const blocked = [...blockedByRef.values()];
  const listed = rows.filter((r) => !r.needsSetup);
  const unusableOf = (r) => r.selectable === false || r.depleted || r.ended || r.terminalOnly;
  const usable = listed.filter((r) => !unusableOf(r));
  const unusable = listed.filter(unusableOf);
  const now = Date.now();
  // The list is NOT in the message: it IS the keyboard. A button carries the same
  // copy /allowance prints for that row, at the same width, so the two surfaces
  // say one thing rather than two versions of it. Nothing is repeated above them,
  // so the body is FREEMODEL_EMPTY_BODY and the counts live on the return value.
  //
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
  // Keyed (non-free) rows leave their tier group for one trailing group: the
  // keyboard spends free lanes first and the user's own key last (live VM5
  // 2026-10-03). The groups above keep their counts honest — a moved row is
  // not counted twice.
  const isKeyedRow = (r) => (r.plan || (r.lane ? planCodeForLane(r.lane) : '')) === 'GM';
  const keyedFallback = [];
  const displayGroups = tierGroups
    .map((g) => ({ ...g, rows: (g.rows || []).filter((r) => {
      if (isKeyedRow(r)) { keyedFallback.push(r); return false; }
      return true;
    }) }))
    .filter((g) => (g.rows || []).length > 0);
  if (keyedFallback.length) displayGroups.push({ tier: 'keyed', rows: keyedFallback });
  for (const g of displayGroups) {
    // A keyboard has no subheadings, so the tier title is a row of its own:
    // `VPS Standard model (10)` — location-scoped, with the group's count.
    // `noop` is the callback the router already uses for a non-actionable
    // keyboard row, and the tap handler answers it silently.
    if (displayGroups.length > 1) {
      buttons.push({ text: headingWidth(g.tier === 'keyed' ? `VPS Keyed fallback (${g.rows.length})` : `${freemodelDisplayTier(g.tier, location || 'vps')} (${g.rows.length})`), data: 'noop', header: true });
    }
  for (const r of g.rows) {
    const label = r.laneLabel || r.label;
    const tag = r.plan || (r.lane ? planCodeForLane(r.lane) : '');
    // The group header above the row says the tier, so the button carries what the row
    // cannot inherit: the plan code, the external benchmark where one is published,
    // and the bakeoff ledger's own verdict. A model with no published figure gets no
    // number at all — never a neighbour's.
    const model = r.lane?.model || r.model || r.ref || '';
    // The button says what the /allowance row says, in the same column order —
    // mark, name, plan, three spaces, benchmark, countdown last — but padded by
    // *rendered width* instead of by character count: the client fits pixels in a
    // proportional font and middle-elides whatever passes its ~415px cut-off, so
    // 72 characters rendered anywhere from 386px to 465px and half the keyboard
    // lost its middle. rowWidth() puts every column at a fixed em offset and
    // every button at COPY_UNITS (24em = 408px), the tier heading's own width.
    // The name goes through shortModelName — the same helper the table's Name
    // column uses — because the raw label carries the surface prefix ("OpenCode
    // Muse Spark 1.3 Cont"), which truncated to a different cut per row and put
    // the plan code against a different letter every time. The reset is the
    // compact countdown, never the absolute label: `resetLabel` is a full
    // timestamp, and fifteen characters of it read "2026-09-26T1".
    const name = shortModelName(r.lane || { label });
    const rawReset = String(r.resetIn || r.resetLabel || '');
    const resetSource = r.resetAt ?? (/^\d{4}-\d{2}-\d{2}/.test(rawReset) ? rawReset : null);
    const rated = rowWidth({
      mark: unusableOf(r) ? '❌' : '✅',
      name,
      plan: tag,
      score: benchmarkLabel(model) || '—',
      resetIn: resetSource ? formatResetIn(resetSource, now) : (rawReset && rawReset !== '-' ? rawReset : '—'),
    });
    const key = `${tag}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // text for the reader, data for the tap: the row's route, so a label that
    // grows (a bakeoff label, a plan tag) can never invalidate the keyboard.
    const route = r.ref || r.lane?.ref || r.model || '';
    buttons.push({ text: rated, data: route, ref: route });
  }
  }
  // The body is a zero-width word joiner, not an empty string: Telegram rejects
  // `sendMessage` with empty text ("Bad Request: message text is non-empty"), and
  // an inline keyboard needs a message to hang off. See FREEMODEL_EMPTY_BODY for
  // which "blank" characters the API actually accepts — U+200B does not, and
  // shipping it took /freemodel down for every reader.
  // Counts are still returned for callers that want them.
  //
  // The one thing the body may carry is what the keyboard CANNOT: a provider whose
  // lanes are not on this host is not a row it could show, so the note goes above
  // the buttons. Everything the keyboard does show is still unsaid above it.
  const setupNote = blockedProviderLines(blocked);
  // With a pool the body has one job the keyboard cannot do: say which pool this
  // is and what happens when it runs dry. Without one it is still exactly
  // FREEMODEL_EMPTY_BODY — the keyboard is the whole message.
  const bodyLines = pool
    ? [
      ...poolNoteLines({
        pool,
        location,
        total: listed.length,
        usable: usable.length,
        soonest: soonestPoolReset([...(annotated || []), ...rows], pool, now),
      }),
      ...setupNote,
    ]
    : setupNote;
  return {
    text: bodyLines.length ? bodyLines.join('\n') : FREEMODEL_EMPTY_BODY,
    buttons,
    rows,
    usable,
    unusable,
    blocked,
    setupNote,
    pool,
  };
}

/** Usable rows the ledger has no record for: honest, not hidden. */
function missingCount(rows) {
  return rows.filter((r) => r.inLedger === false).length;
}

/**
 * TG-native live work view (replaces tmux tail for the phone).
 *
 * Why this exists: tmux `work-view` is host-local — it cannot cross the
 * VM<->phone relay, needs a terminal to attach, and is invisible from the TG
 * chat. The event channel (worker POSTs /jobs/event, bot-host GETs
 * /jobs/<id>/events) carries the same onEvent stream the local run already
 * fans out to the headline + observer log, so remote turns are no longer a
 * black box that only delivers final text.
 *
 * Three pieces, all additive:
 * - follow-up queue: a message sent while busy queues (max 5) instead of
 *   being rejected; the turn loop drains it as new turns on the same
 *   session. /new clears the queue too.
 * - /tui: opens a real terminal for THIS conversation as a Telegram Mini App.
 *   ttyd serves a PTY, the cloudflared wrapper publishes its public URL to a
 *   state file, and /tui reads it (empty = tunnel down, say so). There is no
 *   /web any more: `opencode web` is a chat client rather than a terminal, and
 *   it fought the WebView three separate ways (Basic auth it cannot answer, a
 *   project list held in browser storage, no stable deep link).
 */

export const MAX_FOLLOWUPS = 5;
const followupQueues = new Map();
// The tunnel URL this process last handed out. A quick tunnel's hostname changes
// on every reconnect, so this is how /tui knows an older button is now dead.
let lastMiniappUrl = '';
let lastBugsUrl = '';

export function queuedFollowups(chatId) {
  return followupQueues.get(String(chatId)) || [];
}

export function queueFollowup(chatId, text) {
  const key = String(chatId);
  const queue = followupQueues.get(key) || [];
  if (queue.length >= MAX_FOLLOWUPS) return null;
  queue.push(String(text));
  followupQueues.set(key, queue);
  return queue.length;
}

export function shiftFollowup(chatId) {
  const key = String(chatId);
  const queue = followupQueues.get(key) || [];
  const next = queue.shift() || null;
  if (queue.length) followupQueues.set(key, queue);
  else followupQueues.delete(key);
  return next;
}

export function clearFollowups(chatId) {
  followupQueues.delete(String(chatId));
}

/** Relay live-channel helpers: same bearer token as the job hand-off. */
function relayAuthHeaders(token = process.env.WORKER_RELAY_TOKEN || '') {
  const t = String(token || '');
  return t ? { authorization: `Bearer ${t}` } : {};
}

export async function fetchRelayEvents(relay, jobId, after = 0, { token = process.env.WORKER_RELAY_TOKEN || '' } = {}) {
  try {
    const res = await fetch(`${relayUrl({ url: relay })}/jobs/${encodeURIComponent(jobId)}/events?after=${Number(after) || 0}`, {
      headers: relayAuthHeaders(token),
    });
    if (!res.ok) return { events: [], nextAfter: Number(after) || 0, done: false, aborted: false };
    const body = await res.json().catch(() => ({}));
    return {
      events: Array.isArray(body?.events) ? body.events : [],
      nextAfter: Number(body?.nextAfter ?? after) || 0,
      done: Boolean(body?.done),
      aborted: Boolean(body?.aborted),
    };
  } catch {
    return { events: [], nextAfter: Number(after) || 0, done: false, aborted: false };
  }
}

/**
 * awaitJob plus the live event pump: while the worker runs the turn elsewhere,
 * poll the relay event channel and fan each new event out through onEvent
 * (headline + observer). Without onEvent this is plain awaitJob —
 * zero behavior change for callers that do not stream.
 */
export async function awaitJobWithEventPump(jobId, { timeoutMs = 600000, pollMs = 1000, relay = '', relayToken = '', onEvent = null } = {}) {
  if (typeof onEvent !== 'function') return awaitJob(jobId, { timeoutMs, pollMs });
  const deadline = Date.now() + timeoutMs;
  let after = 0;
  for (;;) {
    const job = getJob(jobId);
    if (job?.doneAt) return job;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return getJob(jobId)?.doneAt ? getJob(jobId) : null;
    const feed = await fetchRelayEvents(relay, jobId, after, { token: relayToken });
    after = feed.nextAfter;
    for (const ev of feed.events) {
      try { await onEvent(ev); } catch {
        // a renderer hiccup must never break the wait
      }
    }
    const recheck = getJob(jobId);
    if (recheck?.doneAt) return recheck;
    await new Promise((r) => setTimeout(r, Math.min(1500, remaining)));
  }
}

/** Phone-hosted opencode web UI (Mini App test): the cloudflared wrapper
 * publishes the current public URL here; /web reads it into a web_app
 * button. Empty = the tunnel is down (it restarts itself; say so). */
export function miniappUrlFile() {
  return process.env.MINIAPP_URL_FILE || '/data/data/com.termux/files/home/.phone-miniapp-url';
}

export function readMiniappUrl(file = miniappUrlFile()) {
  try {
    const url = String(fs.readFileSync(file, 'utf8')).trim();
    return /^https:\/\/[A-Za-z0-9.-]+(\/.*)?$/.test(url) ? url : '';
  } catch {
    return '';
  }
}

/**
 * The URL `/tui` should hand out, in order of preference:
 *   1. TUI_GATEWAY_URL — this host's own terminal behind the gateway, which is
 *      the plan's shape (its own hostname, initData-gated, never the website's).
 *   2. the phone's URL file, for a phone-hosted quick tunnel.
 */
export function readTuiUrl(env = process.env, file = miniappUrlFile()) {
  const gw = String(env.TUI_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[A-Za-z0-9.-]+$/.test(gw)) return gw;
  return readMiniappUrl(file);
}

/**
 * The URL `/tui` hands out for the opencode web UI (split solution: opencode
 * chats read/scroll in the DOM web UI, cline/grok/freebuff keep the TUI).
 * Served by opencode-web.service on localhost, fronted by Caddy on its own
 * hostname behind the same Telegram-initData gate as the TUI — no Tailscale.
 * `OPENCODE_WEB_URL` overrides (tests); empty when unset-and-no-default
 * would apply, so callers can hide the button instead of handing out a dead one.
 */
export function readWebUiUrl(env = process.env) {
  const raw = String(env.OPENCODE_WEB_URL ?? 'https://web.health-tracker.co.uk').trim().replace(/\/+$/, '');
  if (/^https:\/\/[A-Za-z0-9.-]+$/.test(raw)) return raw;
  return '';
}

/** Short-lived personal web UI links minted by /web. */
export const WEB_LINK_TTL_SEC = 4 * 60 * 60;

/**
 * The gateway signing secret, read at call time from the host's own env
 * file (same pattern as the seat-tags credentials: host files, never the
 * repo). Empty when absent — the caller says so instead of minting.
 */
export function gatewaySecretFromHostEnv({ readFile = fs.readFileSync, home = os.homedir() } = {}) {
  try {
    for (const line of String(readFile(path.join(home, '.config', 'bot-host', 'tui-gateway.env'), 'utf8')).split('\n')) {
      const m = line.match(/^TUI_GATEWAY_SECRET=(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* host may not have this file */ }
  return String(process.env.TUI_GATEWAY_SECRET || '').trim();
}

/**
 * A personal web UI login link: a freshly minted ?token= URL no cache or
 * snapshot has ever seen, so it always loads live (the Mini App button's
 * fixed URL can be served a stale saved copy with no server signal). Same
 * short-lived chat-bound bearer the gateway accepts on query; nothing new
 * is trusted. Pure (sensor-covered); '' when anything is missing.
 */
export function personalWebUiLink({ webUrl, botId, chatId, secret, ttlSec = WEB_LINK_TTL_SEC, now = Date.now() } = {}) {
  if (!webUrl || !botId || chatId === undefined || chatId === null || String(chatId) === '' || !secret) return '';
  const token = issueToken({ botId: String(botId), chatId: String(chatId), secret, ttlSec, now });
  return `${String(webUrl).replace(/\/+$/, '')}/?token=${encodeURIComponent(token)}`;
}

export class ProgressRenderer {
  constructor({ api = null, throttle = null, chatId, mode, maxChars, maxEdits, heartbeatMs, progressMode = 'gist', dryRun = false, providerLabel = '', modelLabel = '', thinking = '', onMessageId = null }) {
    this.api = api;
    this.throttle = throttle;
    this.chatId = chatId;
    this.mode = mode;
    this.maxChars = maxChars ?? 220;
    this.maxEdits = maxEdits ?? 120;
    this.heartbeatMs = Math.max(5000, Number(heartbeatMs) || 12000);
    this.dryRun = dryRun;
    this.providerLabel = providerLabel;
    this.modelLabel = modelLabel;
    this.thinkingLevel = thinking;
    // 'gist' = today's behaviour (reasoning prose on the user surface).
    // 'phase' = a truthful label from the tool lifecycle instead. Default
    // 'gist' so this ships as a capability, not a product change; flipping it
    // is config only (`progress.mode` in bots/registry.json).
    this.progressMode = progressMode === 'phase' ? 'phase' : 'gist';
    this.onMessageId = onMessageId;
    this.startedAt = null;
    this.usedTokens = null;
    // The context window of the lane actually running, when the catalog knows
    // it (set by the turn at attempt start, right beside setHeadline). 0 means
    // unknown, and the headline then falls back to the static free-lane map —
    // never a percentage invented from a missing limit.
    this.ctxLimit = 0;
    this.messageId = null;
    this.edits = 0;
    this.creating = false;
    this.createRetryAt = 0;
    // `thinkingLevel` is the configured reasoning LEVEL (low/high/xhigh).
    // `thinkingText` is a gist of the reasoning CONTENT. They were both called
    // "thinking" and both rendered under that one word, so /status reporting a
    // level and the headline reporting a sentence looked like the same field.
    this.thinkingText = '';
    this.reasoning = createReasoningReducer({ maxChars: this.maxChars });
    this.tool = '';
    this.toolDetail = '';
    this.toolStartedAt = null;
    // M2 ledger (plan/TG_TOOL_SURFACE.md): the last six tools, each with
    // name, status, target, and a duration that starts when that tool starts.
    // A repeated call of the same tool replaces that tool's line without
    // resetting its clock; identical consecutive calls collapse with a count.
    this.steps = [];
    // Set when the tool list changes since the last paint: tool changes (and
    // heartbeats) still paint after the reasoning edit budget is spent, so
    // the bubble coalesces to the latest body instead of freezing.
    this.toolChangedSincePaint = false;
    // Settle label for the final bubble: '✓ Done', 'Stopped', or 'Aborted'.
    this.settledLabel = '';
    this.lastOutput = '';
    this.lastEventAt = null;
    this.lastRendered = '';
    this.status = 'starting';
    this.typingTimer = null;
    this.typingIntervalMs = 4000;
    this.heartbeatTimer = null;
  }

  setHeadline({ providerLabel, modelLabel, thinking } = {}) {
    if (providerLabel != null) this.providerLabel = providerLabel;
    if (modelLabel != null) this.modelLabel = modelLabel;
    if (thinking != null) this.thinkingLevel = thinking;
  }

  /** The running lane's context window, from the catalog (best-effort). */
  setCtxLimit(limit) {
    const value = Number(limit) || 0;
    if (value > 0) this.ctxLimit = value;
  }

  _tail(text, max = 180) {
    const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!oneLine) return '';
    return oneLine.length > max ? `…${oneLine.slice(-max)}` : oneLine;
  }

  /** Where the turn got to, for error notices: last tool + last output. */
  lastActivityLine() {
    const bits = [];
    if (this.tool) {
      const runtime = this.toolStartedAt
        ? ` · ${Math.max(0, Math.round((Date.now() - this.toolStartedAt) / 1000))}s`
        : '';
      const detail = this.toolDetail ? ` ${this._tail(this.toolDetail, 80)}` : '';
      bits.push(`Tool ${this.tool}${runtime}${detail}`);
    }
    if (this.lastOutput) bits.push(`Out: ${this._tail(this.lastOutput, 140)}`);
    else if (this.thinkingText) bits.push(`Thinking: ${this._tail(this.thinkingText, 140)}`);
    if (!bits.length) return '';
    return `Last: ${bits.join(' / ')}`;
  }

  timeoutResumeHint() {
    return 'Next: reply to continue the same session, or /new to restart — smaller asks finish faster.';
  }

  _render() {
    const lines = [];
    const now = Date.now();
    const elapsedSec = this.startedAt ? (now - this.startedAt) / 1000 : 0;
    if (this.settledLabel) {
      const modelBit = [this.providerLabel, this.modelLabel].filter(Boolean).join(' ');
      // The usage block the working headline showed, built by the same helper.
      // It used to be dropped here, so the ONE bubble the turn ends on — the
      // one left at the bottom of the chat — was the only one with no tokens
      // and no context percent, while the line it replaced seconds earlier had
      // both (`✓ Done · Gemini … · 110s` beside a bare `ctx 539 tokens` footer,
      // live 2026-10-06). Parity is by construction: both branches read the
      // same fields through `formatUsageSuffix`.
      const { suffix } = formatUsageSuffix({
        used: this.usedTokens,
        ctxLimit: this.ctxLimit || ctxLimitFor(this.modelLabel),
      });
      lines.push(`${this.settledLabel}${modelBit ? ` · ${modelBit}` : ''} · ${Math.max(0, Math.round(elapsedSec))}s${suffix}`);
    } else {
      lines.push(
        formatWorkingHeadline({
          providerLabel: this.providerLabel || 'Agent',
          modelLabel: this.modelLabel,
          thinking: this.thinkingLevel,
          elapsedSec,
          used: this.usedTokens,
          ctxLimit: this.ctxLimit || ctxLimitFor(this.modelLabel),
          detail: this.status,
        }),
      );
    }
    // Node 3 (PROGRESS-SURFACES-1) ships as a CAPABILITY, off by default.
    //
    // The evidence says the user surface should carry a truthful phase label
    // rather than reasoning prose: visible chain-of-thought mentioned the
    // driving hint only 25% of the time on Claude 3.7 and 39% on R1, and
    // users end up arguing with the reasoning instead of the answer
    // (ollama #8528, open-webui #8706 ask for it hidden outright).
    //
    // That is a product decision, so it is NOT made here. Default `off` keeps
    // today's behaviour byte-for-byte; flipping it to `phase` is a one-word
    // config change and needs no code edit.
    if (this.progressMode === 'phase') {
      const phase = phaseLabelFor(this.tool, this.settledLabel ? 'done' : this.status);
      if (phase) lines.push(`Phase: ${phase}`);
    } else if (this.thinkingText) {
      lines.push(`Thinking: ${String(this.thinkingText).replace(/\s+/g, ' ').trim()}`);
    }
    if (this.steps.length > 1) {
      lines.push('So far:');
      for (const step of this.steps) lines.push(`· ${this._stepLine(step, now)}`);
    } else if (this.steps.length === 1) {
      lines.push(`Tool: ${this._stepLine(this.steps[0], now)}`);
    } else if (this.tool) {
      const running = this.toolStartedAt ? ` · ${Math.max(0, Math.round((now - this.toolStartedAt) / 1000))}s` : '';
      const detail = this.toolDetail ? ` ${this._tail(this.toolDetail, 90)}` : '';
      lines.push(`Tool: ${this.tool}${running}${detail}`);
    }
    if (this.lastOutput) lines.push(`Result: ${this._tail(this.lastOutput, 140)}`);
    if (this.startedAt) {
      const idleSec = Math.max(0, Math.round((now - (this.lastEventAt || this.startedAt)) / 1000));
      if (idleSec >= 45) lines.push(`⚠️ no update ${idleSec}s — still running (long tool or stuck?)`);
      else lines.push(`↻ upd ${idleSec}s ago`);
    }
    return lines.join('\n');
  }

  async start() {
    if (this.dryRun) {
      console.log('[progress] typing...');
      this.messageId = 1;
      return;
    }
    this.startedAt = Date.now();
    this.lastEventAt = this.startedAt;
    this._startTyping();
    this._startHeartbeat();
  }

  /**
   * Post the headline immediately (status: starting) instead of waiting for
   * the model's first thinking/tool event. A slow lane can take a minute to
   * emit anything, and until then the chat stares at bare typing with no
   * proof the turn started. Call after setHeadline so the first paint already
   * names the right provider + model. Never throws — a failed create just
   * falls back to the old lazy path (first event creates it).
   */
  async announce() {
    if (this.dryRun || this.messageId != null || this.creating || Date.now() < this.createRetryAt) return;
    this.creating = true;
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

  _startHeartbeat() {
    if (this.dryRun || this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      try {
        this._schedule(true);
      } catch {}
    }, this.heartbeatMs);
    if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref();
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  stopTyping() {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
    this._stopHeartbeat();
  }

  /** One ledger line per tool step (plan/TG_TOOL_SURFACE.md M2). */
  _stepLine(step, now) {
    const secs = Math.max(0, Math.round(((now || Date.now()) - step.startedAt) / 1000));
    const count = step.count > 1 ? ` ×${step.count}` : '';
    const target = step.target ? ` ${this._tail(step.target, 60)}` : '';
    return `${step.label}${count} (${step.status})${target} · ${secs}s`;
  }

  _recordTool(name, status, target, output) {
    const now = Date.now();
    const label = String(name || 'tool');
    const key = label;
    const cleanTarget = String(target || '').replace(/\s+/g, ' ').trim();
    const out = output != null ? String(output) : '';
    const last = this.steps.length ? this.steps[this.steps.length - 1] : null;
    const existing = this.steps.find((s) => s.key === key);
    if (last && last.key === key && last.status === status && last.target === cleanTarget && !out.trim()) {
      // Identical consecutive call: one line with a count, clock untouched.
      last.count = (last.count || 1) + 1;
      last.updatedAt = now;
    } else if (existing) {
      // Repeated call of the same tool: replace that tool's line, keep its clock.
      existing.status = status;
      if (cleanTarget) existing.target = cleanTarget;
      existing.count = 1;
      existing.updatedAt = now;
    } else {
      this.steps.push({ key, label, status, target: cleanTarget, startedAt: now, updatedAt: now, count: 1 });
      if (this.steps.length > 6) this.steps.shift();
    }
    // Legacy single-tool fields stay for lastActivityLine() compat.
    this.tool = `${label} (${status})`;
    const clock = existing || this.steps[this.steps.length - 1];
    this.toolStartedAt = clock ? clock.startedAt : now;
    this.toolDetail = cleanTarget || (out ? out : '');
    // One Result: line from tool output; cleared when the next tool has none.
    this.lastOutput = out.trim() ? out : '';
    this.toolChangedSincePaint = true;
  }

  onEvent(event) {
    if (!event || typeof event !== 'object') return;
    if (event.kind === 'reasoning' && event.text) {
      // Proof of life even when the gist is filtered below: a filtered shard
      // still means the model is streaming, so the freshness line keeps that
      // truth instead of crying stuck.
      this.lastEventAt = Date.now();
      // The reducer compresses the ACCUMULATED stream, keyed by part id, so
      // the gist advances with the phase instead of summarising whichever
      // fragment happened to arrive last. It tolerates a delta that beats its
      // own part registration (opencode #26924) and an unbalanced fragment
      // (opencode #43312). `part.type` is the only trustworthy signal — opencode
      // publishes reasoning deltas with field:"text".
      const gist = this.reasoning.push(event.part, { text: event.text });
      // A one-word "gist" is a fragment that slipped through, not a summary.
      if (!gist || gist === this.thinkingText) return;
      this.thinkingText = gist;
      this.status = 'thinking';
      this._schedule();
    } else if (event.kind === 'tool') {
      this.lastEventAt = Date.now();
      const inp = event.input;
      let target = '';
      if (typeof inp === 'string') target = inp;
      else if (inp && typeof inp === 'object') {
        target = String(inp.command || inp.file_path || inp.path || inp.filePath || inp.pattern || inp.glob || '');
      }
      const out = event.output != null ? String(event.output) : '';
      if (!target && out) target = out;
      this._recordTool(event.tool, event.status, target, out);
      this.status = 'working';
      this._schedule();
    } else if (event.kind === 'text' && event.text) {
      // Answer streaming is proof of life only: it must not replace the tool
      // story in the bubble (the final answer is its own message on settle).
      this.lastEventAt = Date.now();
      if (this.status === 'starting') this.status = 'working';
      this._schedule();
    } else if (event.kind === 'step_finish') {
      this.lastEventAt = Date.now();
      if (event.tokens != null && Number.isFinite(Number(event.tokens))) {
        this.usedTokens = (this.usedTokens || 0) + Number(event.tokens);
      }
      this.status = 'working';
      this._schedule();
    } else if (event.kind === 'step_start' || event.kind === 'other' || event.kind === 'error') {
      // Proof of life without a paint: the heartbeat carries the freshness.
      this.lastEventAt = Date.now();
    }
  }

  _schedule(isHeartbeat = false) {
    if (this.dryRun) {
      console.log(`[progress] ${this._render().replace(/\n/g, ' | ')}`);
      return;
    }
    if (!this.throttle || typeof this.throttle.submit !== 'function') return;
    if (this.messageId == null) {
      if (!this.thinkingText && !this.tool && !this.lastOutput) return;
      // One progress message per run: never queue a second create while the
      // first is in flight, and back off after a failed create (rate-limit
      // returns null) instead of spawning a new message per event.
      if (this.creating || Date.now() < this.createRetryAt) return;
      this.creating = true;
      this.throttle
        .submit(async () => {
          try {
            const body = this._render();
            const result = await this._guarded(() => this.api.sendMessage(this.chatId, body));
            if (result?.message_id != null) {
              this.messageId = result.message_id;
              this.lastRendered = body;
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
    // Content edits keep the maxEdits budget (spam guard). Heartbeats bypass
    // it so the clock + freshness line keep moving on long runs — they are
    // still throttled to one edit per throttle window. Tool changes also
    // still paint after the reasoning budget is spent: skipping the
    // intermediate reasoning edits is how flood control is handled, and the
    // next tool change or heartbeat paints the coalesced latest body.
    if (!isHeartbeat) {
      if (this.edits >= this.maxEdits && !this.toolChangedSincePaint) return;
      this.edits += 1;
    }
    const body = this._render();
    if (body === this.lastRendered) return;
    this.lastRendered = body;
    this.toolChangedSincePaint = false;
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

  /** Final bubble: label + elapsed + the same step list (M2). Bypasses the
   * reasoning edit budget like a heartbeat; the final answer stays a
   * separate send and is never gated. */
  settle(label) {
    this.settledLabel = label;
    if (label === '✓ Done') this.status = 'done';
    else if (label === 'Aborted') this.status = 'aborted';
    else this.status = 'stopped';
    if (this.messageId != null) this._schedule(true);
  }

  async finish(result, { footer = '' } = {}) {
    this.stopTyping();
    // The bubble may never have been created (every create/edit failed or
    // was throttled away): without this, a turn whose progress never
    // painted delivers only the answer and the whole work record — tools,
    // durations, thinking — is silently lost ("everything at once at the
    // end", live 2026-10-04). So when no bubble exists, send the settled
    // body as its own message first; the answer below stays separate.
    // Never throws: the answer must still go out.
    if (this.messageId == null && !this.dryRun) {
      try {
        await this.deliver(this._render());
      } catch {
        /* the answer below matters more */
      }
    }
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
      this.settle('Stopped');
      await this.deliver(
        withFooter(
          'Interrupted before the model produced output (the bot process restarted mid-run). Nothing was computed — just send your request again.',
        ),
      );
      return;
    }
    if (errText && !partial) {
      this.status = 'failed';
      this.settle('Stopped');      const friendly = humanizeRunError(errText);
      let hint = '';
      let lead = `Error: ${friendly}`;
      if (isTimeoutError(errText)) {
        lead = `⏱ ${friendly}`;
        const last = this.lastActivityLine();
        hint =
          `${last ? `\n${last}` : ''}\n${this.timeoutResumeHint()}\nTip: retry with /thinking medium, a smaller ask, /model_light_free for a lighter model, or /new for a fresh session.`;
      }
      await this.deliver(`${lead}${errTail}${hint}`);
      return;
    }
    this.status = 'done';
    this.settle('✓ Done');
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
      // never swallow the error silently. On a timeout say where it got to
      // and how to continue — the bare "didn't finish" strands the user.
      let note = `(Finished with an error after partial output: ${humanizeRunError(errText)})`;
      if (isTimeoutError(errText)) {
        const last = this.lastActivityLine();
        note += `${last ? `\n${last}` : ''}\n${this.timeoutResumeHint()}`;
      }
      await this.deliver(note);
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

export async function noteUsage({ chatId, result, eff, config, caches, totals, lastUsage }) {
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
  // Last-run snapshot beside the cumulative totals: sibling bots read this
  // file (not our memory), so without it no one else can show this chat's
  // session usage or its share of the context window.
  prev.last = { ...raw, at: Date.now() };
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

/**
 * The name of THIS machine, which is not the same question as workLocation().
 *
 * workLocation() answers "which compute pool should this turn run on" and
 * answers `vps` on this box. The nudge inbox is keyed by the machine's own
 * identity: every sweep (pending_sweep, session_link, watch_activity,
 * proof_linker) reads `~/.agents/location`, and the duty tells agents to read
 * `~/.agents/nudges/inbox-<location>.md`. Writing proposals to
 * `inbox-vps.md` when the duty says `inbox-vps-france.md` files them where
 * nobody looks — a proposal no agent will ever read is the same as no proposal.
 *
 * `BOT_MACHINE` overrides for tests and for a box with no location file.
 */
export function machineLocation() {
  const override = String(process.env.BOT_MACHINE || '').trim();
  if (override) return override;
  try {
    const declared = fs.readFileSync(path.join(os.homedir(), '.agents', 'location'), 'utf8')
      .trim()
      .split(/\s+/)[0];
    if (declared) return declared;
  } catch {
    /* no location file: fall through to the pool name */
  }
  return workLocation();
}

/**
 * The location this chat asked for, surviving restarts. BOT_LOCATION is
 * process env: a poller restart wipes it, and the next turn silently runs on
 * the physical host again. Chat prefs live in stateDir and are reloaded on
 * boot, so the desired host is re-applied to every turn until the chat names
 * another one. '' = no request, use the physical host.
 */
export function desiredLocation(prefs, chatId) {
  const v = String(prefFor(prefs, chatId)?.location || '').trim().toLowerCase();
  return KNOWN_HOSTS.includes(v) ? v : '';
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
  const identity = checkWorkerMachine({ host, result, home });
  if (!identity.ok) {
    const route = rollbackRoute(host, { jobId: jobId || result?.jobId || '', reason: identity.reason, ...routeOpts });
    return { ok: false, reason: identity.reason, reasons: [identity.reason], route };
  }
  const route = confirmRoute(host, { jobId: jobId || result?.jobId || '', ...routeOpts });
  return { ok: true, reason: '', reasons: [], route };
}

/**
/**
 * QS-9: when the chat's host is dry, the same turn continues on the next
 * connected host with quota — no manual /location, no dropped turn, every hop
 * named. `runTurn(host)` performs one remote turn and reports
 * `{ done, handed }`: done means the answer went out (or the hop held), and a
 * hop is only walked past when it ran dry — empty text with a quota signal.
 * A visited set keeps one bad evening from looping the fleet; when every
 * reachable host is dry the turn stops with 'no location has quota' and no
 * failed lane is ever called twice.
 */
/**
 * QS-4: a handoff pack longer than PACK_SUMMARY_BYTES may earn a written
 * summary; short packs and refused builds never spend a model call on one.
 * Pure decision + text: the model call, if any, goes through `summarizeFn`
 * so the sensor proves the policy without spending quota.
 */
export const PACK_SUMMARY_BYTES = 20 * 1024;

export async function resolvePackPath({ manifest = null, failedLane = '', lanesFn = null, summarizeFn = null } = {}) {
  if (!manifest || !manifest.ok) {
    return { path: 'summary-skipped', reason: manifest?.reason || 'no pack was built', manifest: null };
  }
  const files = manifest.files || [];
  if (manifest.totalBytes <= PACK_SUMMARY_BYTES) {
    return { path: 'disk-pack', manifest };
  }
  const failedTail = String(failedLane || '').toLowerCase().split('/').filter(Boolean).pop() || '';
  let lanes = [];
  try {
    lanes = (await lanesFn?.()) || [];
  } catch {
    lanes = [];
  }
  const models = (Array.isArray(lanes) ? lanes : lanes?.models || [])
    .map(String)
    .filter((m) => m && (!failedTail || !m.toLowerCase().endsWith(failedTail)));
  if (!models.length || typeof summarizeFn !== 'function') {
    return {
      path: 'summary-skipped',
      reason: !models.length ? 'no other lane has allowance' : 'no summary writer wired',
      manifest,
    };
  }
  const lane = models[0];
  try {
    const summary = await summarizeFn({ model: lane, manifest });
    if (!String(summary || '').trim()) throw new Error('empty summary');
    return { path: 'lane-summary', lane, summary: String(summary).trim().slice(0, 1500), manifest };
  } catch (err) {
    return { path: 'summary-skipped', reason: `summary writer failed: ${String(err?.message || err).slice(0, 120)}`, manifest };
  }
}

/** QS-4: the reply always states which pack path wrote it. */
export function packPathLine(resolved) {
  const n = resolved?.manifest?.files?.length || 0;
  const size = resolved?.manifest?.totalBytes ?? 0;
  if (resolved?.path === 'lane-summary') {
    return `📦 handoff pack (${n} files): lane \`${resolved.lane}\` wrote the summary.`;
  }
  if (resolved?.path === 'disk-pack') {
    return `📦 handoff pack (${n} files, ${size} bytes): built from disk, no summary call.`;
  }
  return `📦 handoff pack${n ? ` (${n} files)` : ''}: summary skipped (${resolved?.reason || 'unknown reason'}); disk pack sent.`;
}

/**
 * Stale-session repair gate (decision 1b): a ghost thread id — session 404,
 * "is not on this host" — holds every future remote turn forever, because the
 * row outlives its conversation and preflight fails closed. Malformed ids and
 * opencode outages still hold; only the proven-gone thread repairs, exactly
 * once per turn, with an explicit notice naming it.
 */
export function isStaleSessionPreflight(preflight) {
  if (!preflight || preflight.failed !== 'session') return false;
  return /is not on this host/.test(String(preflight.reason || ''));
}

export async function continueTurnOnNextWorker({ fromHost = '', tried = [], prefer = '', runTurn, statusOf = null } = {}) {
  const hops = [];
  const seen = new Set([String(fromHost || '').toLowerCase(), ...(tried || []).map((h) => String(h || '').toLowerCase())]);
  const candidates = (KNOWN_HOSTS || []).filter(
    (h) => !seen.has(String(h || '').toLowerCase()) && !isLocalHost(h),
  );
  // The requested host goes first when it has not been proven dry: the
  // exhausted branch fires on the local ledger, which says nothing about a
  // remote host's allowance.
  const want = String(prefer || '').toLowerCase();
  candidates.sort((a, b) => (String(b).toLowerCase() === want ? 1 : 0) - (String(a).toLowerCase() === want ? 1 : 0));
  const reachable = [];
  for (const host of candidates) {
    let status = null;
    try {
      status = statusOf ? await statusOf(host) : workerStatus(host);
    } catch {
      status = null;
    }
    if (status && status.reachable) reachable.push(host);
    else hops.push({ host, ok: false, reason: 'unreachable, skipped' });
  }
  for (const host of reachable) {
    seen.add(String(host).toLowerCase());
    let out = null;
    try {
      out = await runTurn(host);
    } catch (err) {
      hops.push({ host, ok: false, reason: String(err?.message || err).slice(0, 200) });
      continue;
    }
    // Delivered means the answer went out; held means the hop never ran (still
    // a wall, not a success — walking past it is the point of the chain).
    if (out && out.done && out.delivered) {
      hops.push({ host, ok: true });
      return { ok: true, host, hops, handed: out.handed || null };
    }
    hops.push({ host, ok: false, reason: String((out && (out.reason || (out.held ? 'held' : ''))) || 'dry').slice(0, 200) || 'dry' });
  }
  return { ok: false, reason: 'no location has quota', hops };
}

/**
 * The job must come from an identified machine, and from the machine presence
 * currently names for this host. A ledger suffix alone cannot tell a labeled
 * stand-in (or anything else dialing as this host) from the real device: the
 * stand-in's ledger ends in worker-<host> too. Fail closed, by name.
 */
export function checkWorkerMachine({ host = '', result = {}, home } = {}) {
  const machine = result?.machine && typeof result.machine === 'object' ? result.machine : null;
  const got = String(machine?.hostname || '').trim();
  if (!got) return { ok: false, reason: 'no machine identity reported by the worker' };
  const presence = workerStatus(host, home ? { home } : {});
  const want = String(presence?.machine?.hostname || '').trim();
  if (want && want !== got) {
    return { ok: false, reason: `worker identity changed: presence says ${want}, the job came from ${got}` };
  }
  return { ok: true, reason: '', machine: got, standin: presence?.standin === true };
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

/**
 * Restart this bot's own unit so a registry change (e.g. a new `/role`) takes
 * effect. The fleet runs units in two scopes — user scope for forge-created
 * bots, system scope for the older ones — so the owning scope is detected, not
 * assumed. The caller sends its reply first: on success this process dies to
 * SIGTERM mid-restart and nothing after runs; on failure the bot is still
 * alive and the caller sends the manual command as a follow-up.
 * Returns { ok, scope?, manual?, skipped? }.
 */
async function restartOwnUnit(botId) {
  // Test seam: the simulate E2E proves the registry write without rebooting
  // the test box. Production never sets this (a role without a restart is a
  // row the running process ignores).
  if (process.env.BOT_ROLE_NO_RESTART === '1') {
    return { ok: true, skipped: true };
  }
  const unit = `bot-host@${botId}`;
  try {
    const { stdout } = await execFileP('systemctl', ['--user', 'show', '-p', 'LoadState', unit]);
    if (String(stdout || '').includes('loaded')) {
      await execFileP('systemctl', ['--user', 'restart', `${unit}.service`]);
      return { ok: true, scope: 'user' };
    }
  } catch {
    // Not a user-scope unit — fall through to the system scope attempt.
  }
  try {
    await execFileP('sudo', ['-n', 'systemctl', 'restart', `${unit}.service`]);
    return { ok: true, scope: 'system' };
  } catch (err) {
    return { ok: false, manual: `systemctl --user restart ${unit}  (or: sudo systemctl restart ${unit}) — ${String(err?.message || err).slice(0, 160)}` };
  }
}

/** Registry file this process serves (honours --registry / OPENCODE_BOT_REGISTRY). */
let ACTIVE_REGISTRY_PATH = null;

function registryFileInUse() {
  if (ACTIVE_REGISTRY_PATH) return ACTIVE_REGISTRY_PATH;
  try {
    return resolveRegistryPath(null, REPO_ROOT);
  } catch {
    return path.join(REPO_ROOT, 'bots', 'registry.json');
  }
}

/** Role catalog lives next to the registry in use, so fixtures stay hermetic. */
function rolesFileInUse() {
  return path.join(path.dirname(registryFileInUse()), 'roles.json');
}

/**
 * Deterministic /bugs body: the live card list, read from the store in the
 * command handler — never composed by the model.
 *
 * Why this exists (measured 2026-09-30): the ticket bot answered "what's the
 * list" with 4 cards from its own chat history while the store held 15,
 * because the read is a tool call the model may skip and a stale session may
 * never re-issue. The /bugs reply is code, so its number cannot be bypassed:
 * it quotes the live read's `count` and `generated_at`, then one line per
 * card in public_n order. A stale session can be wrong about phrasing, but
 * not about this number.
 */
export function formatBugsListText(parsed) {
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : null;
  if (!rows) {
    const err = String(parsed?.error || '').slice(0, 160);
    return `Bug store unreachable (bug API down or not local to this host). /bugs needs the store — retry later.${err ? ` ${err}` : ''}`;
  }
  const count = Number(parsed?.count ?? rows.length);
  const at = String(parsed?.generated_at || '').trim();
  const head = `🐛 *Bug queue* — ${count} card${count === 1 ? '' : 's'}${at ? ` (live read ${at})` : ''}.`;
  if (!rows.length) return `${head}\nThe queue is empty — no tickets on the store.`;
  const sorted = [...rows].sort((a, b) => Number(a?.public_n ?? 0) - Number(b?.public_n ?? 0));
  // Telegram caps a message at 4096 chars; ~40 cards fit, the rest live behind
  // the board button in the same message.
  const MAX_ROWS = 40;
  const lines = sorted.slice(0, MAX_ROWS).map((r) => {
    const n = r?.public_n ?? '?';
    const title = String(r?.title || '(untitled)').replace(/\s+/g, ' ').trim().slice(0, 80);
    const st = [r?.state, r?.queue].filter(Boolean).join('/');
    return `#${n} ${title}${st ? ` (${st})` : ''}`;
  });
  if (sorted.length > MAX_ROWS) lines.push(`… +${sorted.length - MAX_ROWS} more (open the board for the full list).`);
  return `${head}\n${lines.join('\n')}`;
}

async function bugsListText() {
  let parsed;
  try {
    parsed = JSON.parse(await runBugctl(['list', '--json']));
  } catch (e) {
    return `Bug store unreachable (bug API down or not local to this host). /bugs needs the store — retry later. ${String(e?.message || '').slice(0, 120)}`;
  }
  return formatBugsListText(parsed);
}

/**
 * `/do-*` skills the operator can type (plan/TG_TOOL_SURFACE.md M3).
 * Telegram menus cannot register a hyphen, so these are typed, not buttons —
 * and the slash-forward in handleMessage delivers them to the tool as the
 * prompt. Sources: the canonical `~/.agents/skills` plus this bot's
 * `agent.sharedSkills` (workspace-relative entries resolve against the
 * workspace, `~` against home). A skill counts when its directory holds a
 * SKILL.md.
 */
export function listTypedSkills(config) {
  const found = new Map();
  const roots = [];
  try {
    roots.push(path.join(os.homedir(), '.agents', 'skills'));
  } catch {}
  const shared = config?.agent?.sharedSkills;
  const list = Array.isArray(shared) ? shared : [];
  for (const raw of list) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    if (value === '~') roots.push(os.homedir());
    else if (value.startsWith('~/')) roots.push(path.join(os.homedir(), value.slice(2)));
    else if (path.isAbsolute(value)) roots.push(value);
    else roots.push(path.resolve(config?.agent?.workspace || '.', value));
  }
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry || typeof entry.isDirectory !== 'function' || !entry.isDirectory()) continue;
      const dirName = String(entry.name || '');
      if (!dirName.startsWith('do-')) continue;
      const skillFile = path.join(root, dirName, 'SKILL.md');
      let readable = false;
      try {
        readable = fs.statSync(skillFile).isFile();
      } catch {
        readable = false;
      }
      if (!readable) continue;
      const cmd = `/${dirName}`;
      if (!found.has(cmd)) {
        let blurb = '';
        try {
          const head = String(fs.readFileSync(skillFile, 'utf8')).slice(0, 1200);
          const m = head.match(/^\s*description\s*:\s*>?-?\s*(.+)$/m);
          if (m) blurb = m[1].trim().slice(0, 120);
        } catch {}
        found.set(cmd, blurb);
      }
    }
  }
  return [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function handleCommand({ api, config, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, chatId, cmd, userId = 0, kind = 'direct' }) {
  const eff = effective(config, prefs, chatId);

  /**
   * The one picker body: the three pool commands render this, each filter of the
   * one canonical list and nothing else. Three copies of this body is exactly how
   * the three lists would drift apart from each other and from /allowance.
   */
  const sendFreeModelPicker = async ({ pool = null } = {}) => {
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
    // to use instead. Filtering them out of the keyboard is what made the two
    // commands list different things.
    // The table getAnnotatedFreeModels already folded the catalog into — the same
    // one the annotation was computed against and the same one /allowance renders.
    // Folding the union again here produced a different table (46 lanes against
    // 48) and six models came back that the real list has dropped.
    const body = formatFreemodelWithDepletion(entries, annotated, {
      current: eff.model,
      location: workLocation(),
      pool,
      canonical: canonicalAllowanceLanes({ table: fmTable, session: fmSession, readiness: hostReadiness(caches), location: workLocation() }),
      tableLanes: (fmTable && fmTable.lanes) || [],
    });
    // One keyboard with every model, no paging, and the router's cancel row.
    await api.sendMessage(chatId, body.text, {
      // HTML, not Markdown: the table is a <code> block, which is the only
      // left-aligned column-true rendering Telegram has, and Markdown has no
      // equivalent that keeps columns.
      parse_mode: 'HTML',
      reply_markup: modelKeyboard(body.buttons, {
        kind: 'fm',
        all: true,
        footer: { text: headingWidth('Cancel — keep current model'), callback_data: 'noop' },
      }),
    });
  };

  // Deep links (`t.me/<bot>?start=<payload>`) arrive as `/start <payload>`.
  const route = resolveCommandName(cmd);
  switch (route) {
    case 'start':
      clearActiveThread(chatId);
    case 'help':
      await api.sendMessage(chatId, helpText(config, eff));
      return;

    case 'status_all': {
      // Council table, not a second /status: one row per agent in this
      // chat's council (coordinator + seat holders), read from on-disk state
      // (each bot is its own process, so live memory of other bots is not
      // visible here — the table says which bot to ask for its own /status).
      // In a group the addressed bot (bare command: the master) renders it,
      // so the room gets one table, not one reply per bot.
      const statusAllProject = getChatProject(chatId);
      const statusAllWorkspace = statusAllProject.type === 'external' ? statusAllProject.workspace : config.agent.workspace;
      const statusAllTax = statusAllProject.id === TAX_PROJECT_ID;
      const fleetRows = fleetChatStatus({
        chatId: String(chatId),
        workspace: statusAllWorkspace,
        root: REPO_ROOT,
        home: HOME,
        seats: statusAllTax ? TAX_SEAT_IDS : HEALTH_SEAT_IDS,
        roleOf: statusAllTax ? taxRoleOf : healthRoleOf,
      });
      const statusAllCaption = `Fleet status · chat ${String(chatId)} · ${fleetRows.length} agent${fleetRows.length === 1 ? '' : 's'} (via ${config.id})`;
      // The readable table ships as the telegram-tables skill grid
      // (JSON -> qa-evidence/build-table.py -> HTML document, the /allowance
      // table pattern): Telegram text has no grid rendering. Anything failing
      // here falls back to the monospace text table, so the command never
      // comes back empty.
      try {
        const { writeFleetStatusDoc } = await import('./lib/fleet-status-html.mjs');
        const live = fleetRows.filter((r) => r.enabled !== false);
        const uniform =
          live.length > 0 && live.every((r) => r.model === live[0].model && r.agent === live[0].agent);
        const htmlDir = path.join(os.tmpdir(), `bot-host-status-all-${config.id}`);
        fs.mkdirSync(htmlDir, { recursive: true });
        const doc = writeFleetStatusDoc(fleetRows, {
          title: statusAllCaption,
          subtitle: uniform ? `all: ${live[0].model || '—'} · ${live[0].agent || '—'}` : '',
          dir: htmlDir,
        });
        try {
          await api.sendMediaFile(chatId, doc.htmlPath, { caption: statusAllCaption });
          return;
        } finally {
          try {
            fs.unlinkSync(doc.htmlPath);
          } catch {}
          try {
            fs.unlinkSync(doc.jsonPath);
          } catch {}
        }
      } catch {}
      await api.sendMessage(chatId, formatFleetStatusTable(fleetRows, { chatId: String(chatId), via: config.id }));
      return;
    }

    case 'status': {
      const location = workLocation();
      const workId = sessionKey({ location, chat: String(chatId), workspace: config.agent.workspace, project: projectIdForWorkspace(config.agent.workspace) });
      const work = statusForTelegram(workId, { sessionName: WORK_VIEW_SESSION });
      const effSurface = parseModelRef(eff.model).surface;
      // The requested route, not just the physical host: after a restart the
      // env var is gone, and without this line the chat cannot tell that its
      // saved /location is still pending (or that the worker went silent).
      const desired = desiredLocation(prefs, chatId);
      const desiredPresence = desired && !isLocalHost(desired) ? workerStatus(desired) : null;
      const routeLines = [];
      if (desired) {
        const state = isLocalHost(desired) ? 'local' : routeState(desired) || 'never routed';
        routeLines.push(`route: requested ${desired} (${state})`);
        if (desiredPresence) {
          routeLines.push(
            `worker: ${machineLabel(desiredPresence.machine)}${desiredPresence.standin ? ' — ⚠️ stand-in' : ''} · ${desiredPresence.reachable ? 'reachable' : `unreachable (${desiredPresence.reason})`}`
          );
        }
      }
      // Named and aged, because a warm pane and an abandoned one are otherwise
      // indistinguishable from out here — a tmux session outlives its attacher
      // by design, so uptime alone never says whether anyone is in it.
      // Scoped: a row belonging to another project is not this chat's session,
      // and printing it is how a Health-tracker /status came to advertise a PIP
      // Defense Council conversation.
      const statusProject = getChatProject(chatId);
      const statusWorkspace = statusProject.type === 'external' ? statusProject.workspace : config.agent.workspace;
      const activeStatusSession = sessionForWorkspace(sessions, chatId, statusWorkspace);
      // The seat this chat runs in, so /status answers which role the agent is
      // using — the PM seat included (`/role pm take`). Unknown or unset means
      // general mode, never a guessed name.
      const statusRole = checkRoleDetails(statusProject.id, getChatRole(chatId) || '')?.name || null;
      const tuiLine = tuiStatusLine(config.id, activeStatusSession);
      const snap = buildStatusSnapshot({
        bot: { id: config.id, name: config.name },
        platform: effSurface || 'opencode',
        capabilities: { compact: true, costTracking: true, backends: false },
        effective: eff,
        session: activeStatusSession ? { id: activeStatusSession, workspace: statusWorkspace } : null,
        role: statusRole,
        handoff: Boolean((prefFor(prefs, chatId)).handoff),
        usage: lastUsage?.get(chatId) || null,
        totals: totals?.get(chatId) || null,
        runtime: {
          bootedAt,
          taskState: running.get(chatId) ? 'running' : 'idle',
          lock: lockHolder(),
        },
        health,
        extras: [
          ...(work
            ? [
                `work session: ${work.id} (${work.state})`,
                `observer: ${work.probe?.observerLive ? 'live' : work.probe?.surface === 'terminal' ? 'offline' : 'unavailable'}`,
                `controller: ${effSurface || 'opencode'}`,
                `debug: ${work.probe?.events ? 'structured events' : 'unavailable'}`,
              ]
            : ['work session: none', 'observer: unavailable', `controller: ${effSurface || 'opencode'}`, 'debug: structured events']),
          tuiLine,
          ...routeLines,
        ],
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
      clearFollowups(chatId);
      clearActiveThread(chatId);
      // Failproof-sync: an open terminal belongs to the OLD session. Leaving
      // it up guarantees the "TUI shows another conversation" desync, so /new
      // takes it down (verified kill, same path as /tui off) and the next /tui
      // tap rebuilds on the fresh session. The old session itself is untouched.
      let paneNote = '';
      const stalePane = readTuiPane(config.id);
      if (stalePane && hasTuiPane(stalePane)) {
        killTuiPane(stalePane);
        if (!hasTuiPane(stalePane)) {
          try {
            fs.rmSync(tuiLeasePath(config.id), { force: true });
          } catch {
            /* the pane is gone either way */
          }
          try {
            fs.rmSync(tuiPanePath(config.id), { force: true });
          } catch {
            /* the pane is gone either way */
          }
          // The honest half: /new deleted the session row above, so there is
          // no session for /tui to attach to until the next message binds one.
          // This used to promise /tui a fresh terminal on the new session, which
          // cannot be true at this moment, and it is exactly what a user acted on
          // 20s later to reach a terminal that refused to open
          // (live 2026-10-05).
          paneNote = `\nClosed the old terminal pane (\`${stalePane}\`) — it showed the previous session. This chat has no session of its own yet: the next message you send starts one, and \`/tui\` after that lands on it.`;
        } else {
          paneNote = `\n⚠️ Could not close the old terminal pane (\`${stalePane}\`) — it still shows the previous session. \`/tui off\` retries the kill.`;
        }
      }
      await api.sendMessage(chatId, `Started a fresh session.${paneNote}`);
      return;

    case 'compact': {
      if (running.get(chatId)) {
        await api.sendMessage(chatId, 'A request is already running. Wait for it to finish, then try again.');
        return;
      }
      const compactProject = getChatProject(chatId);
      const compactSessionId = sessionForWorkspace(
        sessions,
        chatId,
        compactProject.type === 'external' ? compactProject.workspace : config.agent.workspace,
      );
      if (!compactSessionId) {
        await api.sendMessage(chatId, formatCompactEmpty());
        return;
      }
      // One bubble, edited in place when the answer lands. Compaction is slow
      // enough that a second "done" message is just noise above the receipt.
      const notice = await api.sendMessage(chatId, 'Compacting this session…');
      const receipt = (text) => (notice && typeof api.editMessageText === 'function'
        ? api.editMessageText(chatId, notice.messageId, text).catch(() => api.sendMessage(chatId, text))
        : api.sendMessage(chatId, text));
      try {
        // Compact the session the chat is actually on, in place: the tool
        // collapses the transcript into one summary entry and the same session
        // id carries the next turn, so there is nothing to rebind and no
        // handoff brief to inject. On an external project that is the external
        // folder, with the same restricted child env as a normal turn, not the
        // website checkout.
        const compactProject = getChatProject(chatId);
        const compactExternal = compactProject.type === 'external';
        running.set(chatId, { aborted: false });
        const outcome = await compactSession({
          sessionId: compactSessionId,
          workspace: compactExternal ? compactProject.workspace : config.agent.workspace,
          env: { ...opencodeEnv(config), ...chatEnv(api, chatId) },
          envMode: compactExternal ? 'project' : 'inherit',
          opencodeBin: config.agent.opencodeBin,
          timeoutMs: config.agent.timeoutMs,
        });
        if (outcome.ok) {
          await receipt(formatCompactReceipt(outcome));
        } else if (outcome.reason === 'empty') {
          await receipt(formatCompactEmpty());
        } else {
          await receipt(formatCompactFailure({ sessionId: compactSessionId, reason: outcome.reason }));
        }
      } catch (err) {
        await receipt(formatCompactFailure({ sessionId: compactSessionId, reason: err.message })).catch(() => {});
      } finally {
        running.delete(chatId);
      }
      return;
    }

    case 'model':
    case 'models': {
      // Retired names. A pointer, not a setter: clearing `pool` here was how a
      // typed /model left a pool, and that setter is gone. Deleting the case
      // would make isKnownCommand() false and the typed name would run as a prompt.
      await api.sendMessage(chatId, POOL_POINTER);
      return;
    }

    case 'store': {
      // G-1's face in the chat. The store is a background concern, so the honest
      // thing is to let a human ask how it is doing and force a drain on demand —
      // rather than discovering a broken queue from a missing row days later.
      const sub = String(args[0] || 'status').toLowerCase();
      const status = storeStatus(config.id);
      if (sub === 'flush') {
        const writer = await writerFor(process.env, { force: true });
        if (!writer.ok) {
          await api.sendMessage(chatId, `<b>Store</b> — cannot flush: ${escapeHtml(writer.reason || 'not enrolled')}`, { parse_mode: 'HTML' });
          return;
        }
        await api.sendMessage(chatId, '<b>Store</b> — flushing…', { parse_mode: 'HTML' });
        const report = await flushTurns(config.id, makeSends(writer, process.env), { limit: 200 });
        const after = storeStatus(config.id);
        const lines = [
          '<b>Store flush</b>',
          `sent: ${report.sent} · failed: ${report.failed} · still queued: ${after.pending}`,
          report.firstError ? `first error: ${escapeHtml(report.firstError.slice(0, 200))}` : '',
          `identity: ${escapeHtml(writer.kind)}${writer.account ? ` (${escapeHtml(writer.account)})` : ''}`,
        ].filter(Boolean);
        await api.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });
        return;
      }
      const writer = await writerFor(process.env);
      const rows = status.pending
        ? Object.entries(status.byKind).map(([k, v]) => `${k}: ${v}`).join(' · ')
        : 'nothing queued';
      const lines = [
        '<b>Google store</b>',
        `queued: ${status.pending}${status.pending ? ` (${rows})` : ''}`,
        `oldest: ${status.oldest ? escapeHtml(status.oldest) : '—'}`,
        `identity: ${writer.ok ? escapeHtml(`${writer.kind}${writer.account ? ` · ${writer.account}` : ''}`) : `not ready — ${escapeHtml(writer.reason || '')}`}`,
        storeFlushNote ? `last flush: ${escapeHtml(storeFlushNote)}` : '',
        `spool: ${escapeHtml(status.dir)}`,
        '',
        '/store flush — drain the queue now',
      ].filter(Boolean);
      await api.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });
      return;
    }
    case 'freemodel':
    case 'freemodels': {
      // The old name still answers, and it answers with a POINTER. Deleting it
      // outright would make isKnownCommand() false, so a typed `/freemodel` would
      // fall through to the tool as a prompt — the opposite of helpful — and a host
      // still on the previous build during a roll keeps reaching a real answer.
      // One line, no list, no keyboard, nothing billed.
      await api.sendMessage(chatId, POOL_POINTER);
      return;
    }

    case 'model_light_free':
    case 'model_free':
    case 'model_go': {
      // Set the pool BEFORE showing it: the constraint has to hold for the very
      // next message a reader sends, not only once they tap a lane (decision D2),
      // or a chat that ran /model_light_free would still spend a coding lane on
      // the next quota hit.
      const pool = poolForCommand(route);
      if (!pool) return;
      setPref(prefs, chatId, { pool });
      savePrefs(config.id, prefs);
      await sendFreeModelPicker({ pool });
      return;
    }

    case 'allowance': {
      const arg = String(cmd.args || '').trim().toLowerCase();
      const route = freemodelRefToRoute(eff.model || '');
      if (arg === 'table' || arg === 'html' || arg === 'grid') {
        try {
          const { tablePath, sessionPath, table, dir } = getLedger(config.id);
          if (!table) {
            await api.sendMessage(chatId, 'Allowance: no free-lane ledger found. Use /model_free to list free models.');
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
      lines.push('Lanes for these providers are shown as ⏸ in /allowance and are not offered in the picker (/model_free) until the credential is present.');
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
      // One refusal, no turn, no stored level (plan/TG_TOOL_SURFACE.md M4).
      if (ref.surface === 'gemini') {
        await api.sendMessage(chatId, 'This model has no thinking levels — /thinking does nothing here. Send a normal prompt instead.');
        return;
      }
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
      setPref(prefs, chatId, { variant: target });
      savePrefs(config.id, prefs);
      await api.sendMessage(chatId, `Thinking level set to ${target}.`);
      return;
    }

    case 'skills': {
      const typed = listTypedSkills(config);
      if (!typed.length) {
        await api.sendMessage(chatId, 'No /do-* skills found on this host. The canonical copy is ~/.agents/skills.');
        return;
      }
      const lines = typed.map(([cmd, blurb]) => (blurb ? `${cmd} — ${blurb}` : cmd));
      await api.sendMessage(chatId, `Skills you can type here (typed, not buttons — just send the line):\n${lines.join('\n')}`);
      return;
    }

    case 'tui': {
      // /tui off closes this bot's pane; /tui status reports it. Both live here
      // rather than in the shell because the pane's name belongs to a service
      // file the bot does not read: TUI_TMUX_NAME is set in
      // tui-ttyd-<id>.service, so the only trustworthy source of that name is
      // the lease the attach script publishes. Guessing `VM-tui-<id>` here would
      // drift the first time either side changed, and a wrong name means killing
      // nothing while reporting success.
      const tuiSub = String(cmd.args || '').trim().toLowerCase();
      // The workspace this chat is actually in right now — the same expression
      // the turn uses. Resolved up here (not only on the open path) because
      // /tui status and /tui off below already need the session id: declaring
      // it after them is a temporal-dead-zone ReferenceError that answers
      // neither (every /tui status went silently missing).
      const tuiProject = getChatProject(chatId);
      const tuiWorkspace = tuiProject.type === 'external' ? tuiProject.workspace : config.agent.workspace;
      // Scoped, so /tui hands tui-attach.sh the session for the workspace the
      // chat is in — the identical id the next turn passes.
      const tuiSessionId = sessionForWorkspace(sessions, chatId, tuiWorkspace);
      // The lane, and whether a terminal could be opened on THIS chat's session
      // right now. Resolved here, above status/off/refresh, because all three
      // name the session in their answers and two of them used to promise a
      // terminal that could not be opened (see tuiCanOpen below).
      const tuiSurface = tuiSurfaceFor(effective(config, prefs, chatId).model);
      const tuiCanOpen = canOpenSharedTui(tuiSurface.surface, tuiSessionId);
      // What to say instead of "tap /tui for a terminal" when there is no
      // session behind the promise. Named once because three answers need it and
      // a fresh chat has no session at all until its next message binds one
      // (live 2026-10-05: /new then /tui twenty seconds later).
      const tuiNoSessionAdvice = 'Send me any message first: that starts the conversation this chat shares with the terminal, and `/tui` after it lands on that conversation.';
      if (tuiSub === 'status') {
        await api.sendMessage(chatId, `⌨️ ${tuiStatusLine(config.id, tuiSessionId)}`);
        return;
      }
      if (tuiSub === 'off' || tuiSub === 'kill' || tuiSub === 'stop') {
        const lease = readTuiLease(config.id, tuiSessionId);
        // The lease only exists while a client is attached; a kept pane
        // outlives it (live 2026-10-04: VM-tui-vm2 alive, no lease, and /tui
        // off answered "nothing to close"). Fall back to the last published
        // pane name — a name whose session is gone reads as already closed.
        let pane = lease?.pane || null;
        let sessionLabel = lease?.session ? ` (session ${lease.session.slice(0, 12)}…)` : '';
        if (!pane) {
          pane = readTuiPane(config.id);
          if (!pane) {
            await api.sendMessage(chatId, '⌨️ No TUI pane is open for this chat — nothing to close. `/tui` opens one.');
            return;
          }
          if (!hasTuiPane(pane)) {
            try {
              fs.rmSync(tuiPanePath(config.id), { force: true });
            } catch {
              /* the pane is gone either way */
            }
            await api.sendMessage(chatId, `⌨️ No TUI pane is running — \`${pane}\` is already gone. \`/tui\` opens a fresh one.`);
            return;
          }
        }
        // Refuse while this bot is mid-turn, unless forced. Killing the pane
        // takes the terminal's opencode process with it, and if a turn is
        // running that process may be the one holding the conversation — so say
        // what would be lost and let the user decide before closing.
        if (running.has(chatId) && !/\b(force|yes)\b/.test(tuiSub)) {
          await api.sendMessage(chatId, [
            '⏸ A turn is running right now, so I will not close the terminal out from under it.',
            `Say \`/tui off force\` to close \`${pane}\` anyway, or wait for the turn to finish first.`,
          ].join('\n'));
          return;
        }
        killTuiPane(pane);
        // Verify the kill landed: only then do the lease and the published
        // pane name go with it. A surviving session keeps its records, so a
        // failed kill still reports a pane /status can see.
        const gone = !hasTuiPane(pane);
        if (gone) {
          try {
            fs.rmSync(tuiLeasePath(config.id), { force: true });
          } catch {
            /* the pane is gone either way */
          }
          try {
            fs.rmSync(tuiPanePath(config.id), { force: true });
          } catch {
            /* the pane is gone either way */
          }
        }
        await api.sendMessage(chatId, gone
          ? [
            `💤 Closed \`${pane}\`${sessionLabel}.`,
            'Your scrollback went with it, and it costs nothing while closed. `/tui` opens a fresh one on this same conversation whenever you want it back.',
          ].join('\n')
          : `⚠️ Could not close \`${pane}\` — tmux refused. It may already be gone; \`/tui status\` will say.`);
        return;
      }
      // The universal resync: whatever the pane shows (stale session after a
      // lane failover, a stuck boot like VM-tui-vm3 on the 742-row session, a
      // half-dead attach), killing it verified-dead and reopening rebuilds on
      // THIS chat's current session via the attach-time resolution. /new does
      // this kill automatically; refresh is the manual version. Reopening
      // always needs a fresh tap — ttyd only runs the attach on a new client.
      if (tuiSub === 'refresh' || tuiSub === 'reopen' || tuiSub === 'reload' || tuiSub === 'resync') {
        const refreshPane = readTuiLease(config.id, tuiSessionId)?.pane || readTuiPane(config.id);
        if (!refreshPane || !hasTuiPane(refreshPane)) {
          try {
            fs.rmSync(tuiPanePath(config.id), { force: true });
          } catch {
            /* nothing published either way */
          }
          await api.sendMessage(chatId, `⌨️ No terminal pane is running — nothing to refresh. ${tuiCanOpen ? '`/tui` opens one on this chat\'s current session.' : tuiNoSessionAdvice}`);
          return;
        }
        killTuiPane(refreshPane);
        if (!hasTuiPane(refreshPane)) {
          try {
            fs.rmSync(tuiLeasePath(config.id), { force: true });
          } catch {
            /* the pane is gone either way */
          }
          try {
            fs.rmSync(tuiPanePath(config.id), { force: true });
          } catch {
            /* the pane is gone either way */
          }
          await api.sendMessage(chatId, tuiCanOpen
            ? `🔄 Closed \`${refreshPane}\`. Tap \`/tui\` again — the new pane attaches to this chat's current session.`
            : `🔄 Closed \`${refreshPane}\`. ${tuiNoSessionAdvice}`);
        } else {
          await api.sendMessage(chatId, `⚠️ Could not close \`${refreshPane}\` — tmux refused. \`/tui status\` will say what survived.`);
        }
        return;
      }
      // The actual TUI: ttyd serves a real PTY and mounts it under the same
      // tunnel and the same login, so this is a terminal you type into from
      // inside Telegram. It attaches to THIS chat's session in THIS checkout
      // (resolved per attach by tui-attach.sh).
      //
      // WHICH tool it launches follows the chat's effective lane, not the bot's
      // registry default. It used to be OpenCode unconditionally, so a chat on
      // Cline opened an OpenCode TUI on a stale opencode session id — a
      // different agent on a different thread from the one answering here.
      //
      // There is deliberately no /web any more. `opencode web` is a chat client,
      // not a terminal, and every attempt to make it useful from a phone hit a
      // wall that was the app's own doing: HTTP Basic auth a WebView cannot
      // answer, a project list kept in browser storage so a fresh WebView opens
      // empty, and no deep link that survives a tunnel hostname change. The TUI
      // covers the same ground and is strictly better on a phone; browsing older
      // sessions is a /sessions picker away inside the TUI itself.
      // A gateway URL wins over the phone's quick-tunnel file: it is this host's
      // own terminal, on its own hostname, and it is the one that is not a
      // dead hostname waiting to happen.
      const tuiUrl = readTuiUrl();
      if (!tuiUrl) {
        // Say what is actually true. This used to blame a phone tunnel, which
        // is only the story on the phone: the URL file's default path is a
        // Termux path on EVERY host, so the path cannot be the tell — the
        // platform can (the same markers freemodels.mjs uses for the mobile
        // lane). Measured 2026-09-30: vm3, a VM bot with no gateway URL, was
        // told its "phone tunnel" was down — a tunnel it has no relationship
        // with.
        const onPhone = Boolean(process.env.TERMUX_VERSION || process.env.ANDROID_ROOT);
        await api.sendMessage(chatId, onPhone
          ? '⌨️ TUI is offline — the phone tunnel is down. It restarts itself; try /tui again in a minute.'
          : [
            '⌨️ TUI is not served from this machine yet.',
            'The phone publishes its terminal through a quick tunnel whose hostname changes on every reconnect, and this bot has no URL for it. The VM-side terminal is a separate gateway on its own hostname (`plan/TUI_IMPLEMENTATION.md` step 2), gated on Telegram `initData` so a public PTY is never anonymous.',
            'Until that gateway answers there is no terminal to open here. `/tx on` still gives you the live tool feed in this chat.',
          ].join('\n'));
        return;
      }
      // A quick tunnel's hostname changes on every reconnect, so a button sent
      // in an older message opens a tunnel that no longer exists and the WebView
      // fails with nothing to explain it. Say so rather than let the tap look
      // broken.
      const moved = lastMiniappUrl && lastMiniappUrl !== tuiUrl;
      lastMiniappUrl = tuiUrl;
      // tuiSurface / tuiCanOpen are resolved at the top of this case, with the
      // session they depend on (status, off and refresh all need it).
      if (!tuiSurface.terminal) {
        // An API-only lane has no screen to attach to. Handing it a PTY anyway
        // would be a scraped badge, not a terminal.
        await api.sendMessage(chatId, [
          `⌨️ No terminal for this chat — it is on \`${tuiSurface.tool}\`, which answers in one shot and has no session to attach to.`,
          '`/tx on` still gives you the live tool feed here, and `/model_free` moves the chat to a lane with a real terminal if you want one.',
        ].join('\n'));
        return;
      }
      // No session to share means no terminal worth opening: tui-attach.sh
      // refuses a sessionless opencode open (live 2026-10-04), so the button
      // below would promise a conversation and deliver that refusal on the
      // user's screen. Say it here, where the answer belongs. Asked BEFORE the
      // tui-open.json write so a null session is never recorded as a fact about
      // the chat — that snapshot with `sessionId: null` is what an auditor reads
      // afterwards and cannot tell from a broken record.
      //
      // Live 2026-10-05: `/new` cleared the chat's session row at 10:54:23,
      // `/tui` ran at 10:54:43, wrote the null snapshot and sent the button,
      // and the tap 20s later printed "No chat session recorded yet — nothing
      // shared to attach to" on a phone. tuiSessionId was already resolved at the
      // top of this case; nothing read it on the open path.
      if (!tuiCanOpen) {
        await api.sendMessage(chatId, [
          '⌨️ There is nothing for the terminal to attach to yet — this chat has no session.',
          tuiNoSessionAdvice,
          '(`/new` puts you here on purpose: a fresh chat has no session until your next message.)',
        ].join('\n'));
        return;
      }
      // No session to share means no terminal worth opening: tui-attach.sh
      // refuses a sessionless opencode open (live 2026-10-04), so the button
      // below would promise a conversation and deliver that refusal on the
      // user's screen. Say it here, where the answer belongs. Asked BEFORE the
      // tui-open.json write so a null session is never recorded as a fact about
      // the chat — that snapshot with `sessionId: null` is what an auditor reads
      // afterwards and cannot tell from a broken record.
      //
      // Live 2026-10-05: `/new` cleared the chat's session row at 10:54:23,
      // `/tui` ran at 10:54:43, wrote the null snapshot and sent the button,
      // and the tap 20s later printed "No chat session recorded yet — nothing
      // shared to attach to" on a phone. tuiSessionId was already resolved at the
      // top of this case; nothing read it on the open path.
      if (!tuiCanOpen) {
        await api.sendMessage(chatId, [
          '⌨️ There is nothing for the terminal to attach to yet — this chat has no session.',
          tuiNoSessionAdvice,
          '(`/new` puts you here on purpose: a fresh chat has no session until your next message.)',
        ].join('\n'));
        return;
      }
      // Record which chat opened the TUI, which lane it is on, and the session
      // that lane produced. ttyd runs one static command per bot, so it cannot
      // be told the chat any other way — and tui-attach.sh reading only ids[0]
      // attached every chat to whichever conversation happened to be first in
      // the map. `surface` is what stops the attach from launching OpenCode for
      // a Cline chat; `model` is the lane's own model so the screen names the
      // model actually answering here. Best-effort and never fatal: a missing
      // write just leaves the legacy behaviour in place.
      try {
        writeJson(path.join(stateDir(config.id), 'tui-open.json'), {
          chatId: String(chatId),
          surface: tuiSurface.surface,
          model: effective(config, prefs, chatId).model,
          sessionId: tuiSurface.surface === 'cline'
            ? loadClineSessions(config.id).get(chatId) || null
            : tuiSessionId,
          // The workspace, so tui-attach.sh opens THIS project and not the static
          // TUI_WORKTREE in its service file. See the script for why that guess
          // was showing one project's conversation under another's button.
          workspace: tuiWorkspace,
          at: new Date().toISOString(),
        });
      } catch {
        // fall through to the button below
      }
      // Split solution (plan/WEBUI_MIGRATION.md): opencode chats get the DOM web
      // UI first (native scroll, real text, same sessions via serve) with the
      // terminal as fallback; every other lane keeps the TUI button only —
      // cline/grok/freebuff have no web UI to point at.
      const webUiUrl = tuiSurface.sharedSession ? readWebUiUrl() : '';
      const freshWebLink = webUiUrl
        ? personalWebUiLink({ webUrl: webUiUrl, botId: config.id, chatId, secret: gatewaySecretFromHostEnv() })
        : '';
      const openButtons = [
        ...(freshWebLink
          ? [{ text: '🌐 Open web UI', url: freshWebLink }]
          : webUiUrl
            ? [{ text: '🌐 Open web UI', web_app: { url: `${webUiUrl}/?bot=${config.id}` } }]
            : []),
        { text: '⌨️ Open the TUI', web_app: { url: `${tuiUrl}/?bot=${config.id}` } },
      ];
      await api.sendMessage(chatId, [
        moved ? '⚠️ *The tunnel was reconnected*, so any earlier /tui button is dead — use this one.' : null,
        tuiSurface.sharedSession
          ? `⌨️ *${tuiSurface.label}* — a real terminal, driven by touch, attached to *this* conversation in \`${tuiWorkspace}\`.`
          : [
            `⌨️ *${tuiSurface.label}* — a real ${tuiSurface.tool} terminal in \`${tuiWorkspace}\`, resumed onto the last ${tuiSurface.tool} thread for this chat.`,
            `This chat is on ${tuiSurface.tool} (\`${shortProviderModel(effective(config, prefs, chatId).model)}\`), so that is the screen you get — not opencode.`,
            `_Cline cannot resume a thread headlessly, so this is the last ${tuiSurface.tool} thread and not the one I answer each new message in. Work you type here is yours; it does not come back to this chat._`,
          ].join('\n'),
        tuiSurface.sharedSession
          ? 'What you send here appears there and what you type there is this same conversation. It runs under tmux, so closing the Mini App keeps your place.'
          : 'It runs under tmux, so closing the Mini App keeps your place, and you can reopen the same thread whenever you want.',
        'We both keep working with it open. The terminal waits for a turn I am running, and I wait for a turn you started — one at a time, never two writers at once. Opening it proves you are the Telegram user this chat belongs to, so there is no password to remember.',
        ...(webUiUrl ? [`🌐 Prefer reading over typing? The *web UI* shows this same conversation as a normal page — scrolls natively, no terminal frames.${freshWebLink ? ' The button above is minted fresh for this tap and lasts 15 minutes.' : ''}`] : []),
      ].filter(Boolean).join('\n'), {
        reply_markup: { inline_keyboard: [openButtons] },
      });
      return;
    }

    case 'bugs': {
      // Shared bug board mini app (packet bug-board-miniapp, Node 5). Same
      // web_app button pattern as /tui, served by the same gateway host under
      // /bugs/ behind the initData door. Scoped to the bug ticket bot: it owns
      // the canonical card list.
      // Served from bot-host bots that hold a gateway token. vm is the
      // master bot and validates today; bug_ticket stays listed so the scope
      // is correct if it ever gains a bot-host surface (it is a hermes bot
      // and has no bot-host command path).
      const BOARD_BOTS = ['vm', 'bug_ticket'];
      if (!BOARD_BOTS.includes(config.id)) {
        await api.sendMessage(chatId, '🐛 The bug board lives on the VM bot — ask it for /bugs and it will hand you the button.');
        return;
      }
      const bugsGatewayUrl = readTuiUrl();
      if (!bugsGatewayUrl) {
        const onPhone = Boolean(process.env.TERMUX_VERSION || process.env.ANDROID_ROOT);
        await api.sendMessage(chatId, onPhone
          ? '🐛 Bug board is offline — the phone tunnel is down. It restarts itself; try /bugs again in a minute.'
          : '🐛 Bug board is not served from this machine yet. Set TUI_GATEWAY_URL to the gateway host and try /bugs again.');
        return;
      }
      const boardUrl = `${bugsGatewayUrl}/bugs/?bot=${config.id}`;
      const moved = lastBugsUrl && lastBugsUrl !== boardUrl;
      lastBugsUrl = boardUrl;
      // The card list below is read live from the store by this handler, not
      // composed by the model — so its count is the same number the board
      // shows, even for a stale session that would otherwise answer from chat
      // history.
      const liveList = await bugsListText();
      await api.sendMessage(chatId, [
        moved ? '⚠️ *The tunnel was reconnected*, so any earlier /bugs button is dead — use this one.' : null,
        liveList,
        'What changes here lands in the same list the site shows.',
      ].filter(Boolean).join('\n'), {
        reply_markup: { inline_keyboard: [[{ text: '🐛 Open bug board', web_app: { url: boardUrl } }]] },
      });
      return;
    }

    case 'forge': {
      // One-click bot forge (Mini App). Same web_app button + initData door as
      // /tui and /bugs: the page calls the gateway's /forge/api/* and the whole
      // creation is the single `runForge` pipeline. Scoped to the master bot —
      // it is the one that holds a gateway token and owns the fleet.
      const FORGE_BOTS = ['vm'];
      if (!FORGE_BOTS.includes(config.id)) {
        await api.sendMessage(chatId, '🛠 The bot forge lives on the master bot — ask it for /forge and it will hand you the button.');
        return;
      }
      const forgeGatewayUrl = readTuiUrl();
      if (!forgeGatewayUrl) {
        await api.sendMessage(chatId, '🛠 Bot forge is not served from this machine yet. Set TUI_GATEWAY_URL to the gateway host and try /forge again.');
        return;
      }
      const forgeUrl = `${forgeGatewayUrl}/forge?bot=${config.id}`;
      await api.sendMessage(chatId, [
        '🛠 *Bot forge* — type a name, get a working bot.',
        'One run gets the token, writes the registry row, syncs the env files, wires supervision, proves the token with `getMe`, and enables it — you never edit a `.env` file.',
        'With a userbot session it asks @BotFather itself; otherwise paste the token @BotFather gave you into the page.',
      ].join('\n'), {
        reply_markup: { inline_keyboard: [[{ text: '🛠 Open bot forge', web_app: { url: forgeUrl } }]] },
      });
      return;
    }

    case 'fleet': {
      // Dynamic fleet dashboard (Mini App). Same web_app button + initData door
      // as /tui, /bugs, and /forge: served by the gateway under /fleet/.
      // Served by every bot-host bot: the button carries ?bot=<this bot> and
      // the gateway validates the opener's initData against that bot's token
      // (auto-matching any token it holds), so no per-bot allowlist lives here.
      const fleetGatewayUrl = readTuiUrl();
      if (!fleetGatewayUrl) {
        await api.sendMessage(chatId, '📋 Fleet dashboard is not served from this machine yet. Set TUI_GATEWAY_URL to the gateway host and try /fleet again.');
        return;
      }
      const fleetUrl = `${fleetGatewayUrl}/fleet/?bot=${config.id}`;
      await api.sendMessage(chatId, [
        '📋 *Fleet Dashboard*',
        'Live tickets from PM sheet, terminal panes across all locations (Mac, VM, Mobile, Collab), and fleet bot activity.',
      ].join('\n'), {
        reply_markup: { inline_keyboard: [[{ text: '📋 Open Fleet Dashboard', web_app: { url: fleetUrl } }]] },
      });
      return;
    }

    case 'review': {
      // Human review queue (Mini App). Same web_app button + initData door
      // as /fleet, served by the gateway under /review/. Unlike the fleet
      // board it is NOT scoped to the VM bot: every bot serves its own
      // button, and the gateway accepts initData from any configured bot.
      // Agents set a row's Status to `review` when work is ready for human
      // eyes; the app shows proof screenshots over the original request, and
      // 👍 archives the row while comments append back to the sheet.
      const reviewGatewayUrl = readTuiUrl();
      if (!reviewGatewayUrl) {
        await api.sendMessage(chatId, '⭐ Review queue is not served from this machine yet. Set TUI_GATEWAY_URL to the gateway host and try /review again.');
        return;
      }
      const reviewUrl = `${reviewGatewayUrl}/review/?bot=${config.id}`;
      await api.sendMessage(chatId, [
        '⭐ *Review Queue*',
        'Work marked ready for review: proof screenshots over the original request.',
        '👍 archives a finished item; 💬 sends feedback back to the sheet.',
      ].join('\n'), {
        reply_markup: { inline_keyboard: [[{ text: '⭐ Open Review Queue', web_app: { url: reviewUrl } }]] },
      });
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
        await api.sendMessage(chatId, 'A request is running. Wait for it to finish before checkpointing the work session.');
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

    case 'notify': {
      // Finish alerts for runs started outside Telegram (finish-watch.mjs
      // reads the same prefs file). Default on; `notify: false` silences.
      const sub = String(cmd.args || '').trim().toLowerCase();
      const kept = prefFor(prefs, chatId);
      if (sub === 'off') {
        setPref(prefs, chatId, { ...kept, notify: false });
        savePrefs(config.id, prefs);
        await api.sendMessage(chatId, '🔕 Finish alerts off for this chat — runs you start elsewhere stay there.');
        return;
      }
      if (sub === 'on') {
        const { notify: _dropped, ...rest } = kept;
        setPref(prefs, chatId, rest);
        savePrefs(config.id, prefs);
        await api.sendMessage(chatId, '🔔 Finish alerts on for this chat — when a run you start in the web UI or TUI finishes, its answer lands here and the thread continues on either surface.');
        return;
      }
      const on = kept?.notify !== false;
      await api.sendMessage(chatId, on
        ? '🔔 Finish alerts are on for this chat. `/notify off` silences them.'
        : '🔕 Finish alerts are off for this chat. `/notify on` brings them back.');
      return;
    }


    case 'resume': {
      if (running.get(chatId)) {
        await api.sendMessage(chatId, 'A request is running. Wait for it to finish before resuming a ticket.');
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
        // Drop the old project's session row. Without this the chat kept a
        // session id from the workspace it just left, and the TUI — which
        // resolves its session from this same file — went on attaching the
        // previous project's conversation after a switch.
        sessions.delete(String(chatId));
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
      // Any token that is not `run` is a stage for this project: the runner
      // resolves it against the project's own seats (by id, alias or number) or
      // refuses with the list. It used to accept only the three case
      // checkpoints and answer anything else by running the **whole** council —
      // the one thing a stage command must never do silently.
      if (sub && sub !== 'run' && sub !== 'status') {
        if (running.get(chatId)) {
          await api.sendMessage(chatId, 'A task is already running. Please wait for it to finish first.');
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
          await api.sendMessage(chatId, 'A task is already running. Please wait for it to finish first.');
          return;
        }
        await api.sendMessage(
          chatId,
          `⚖️ *Initiating Multi-Agent Council for "${activeProj.name}"...*\nRunning 6-phase review: Accuracy ➔ Defense ➔ Red-Team ➔ Legal ➔ Arbitrator ➔ Final Dossier.`,
          { parse_mode: 'Markdown' }
        );
        try {
          const res = await runFullCouncil(activeProj.id);
          const reply = `✅ *Council Review Completed!*\n• *Workspace:* \`${res.workspace}\`\n• *Seats run:* ${res.phases.length}\n• *Deliverables:* ${res.deliverables.map((d) => `\`${path.basename(d)}\``).join(' · ')}\n\nType \`/council status\` to see which stages have run.`;
          await api.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        } catch (err) {
          await api.sendMessage(chatId, `❌ Council run failed: ${err.message}`);
        }
        return;
      }

      const status = getCouncilStatus(activeProj.id);
      const phasesText = (status.phases || []).map((p) => `• ${p.index}. ${p.title}: ${p.completed ? '✅ Done' : '⏳ Pending'}`).join('\n');
      // The case councils keep their three checkpoints; every other project is
      // told its own stages, because those are the tokens that resolve.
      const stageHelp = status.pipeline === 'case'
        ? '*Staged Checkpoints (Human-in-the-Loop):*\n• \`/council audit\` — Phase 1: Audit facts & flag missing receipts\n• \`/council defense\` — Phases 2 & 3: Defense arguments & Manager simulation\n• \`/council finalize\` — Phases 4-6: Legal review, arbitrator ruling & final dossier\n• \`/council run\` — Unattended full pipeline'
        : `*Stages:*\n• \`/council <stage>\` — one seat, by id, alias or number (1-${status.phases.length})\n• \`/council all\` — every seat, in order\n• \`/council run\` — every seat, unattended`;
      const ledger = status.pipeline === 'case' ? `\n• *Evidence Ledger:* ${status.hasEvidenceLedger ? '✅ Attached' : '⚠️ Missing'}` : '';
      const ready = status.deliverablesReady ? `✅ ${status.deliverables.length} deliverable(s)` : `⏳ ${status.deliverables.length} expected`;
      const reply = `🏛️ *[Council Status — ${status.name}]*\n• *Workspace:* \`${status.workspace}\`\n• *Google Drive:* \`${status.gdriveFolder}\`${ledger}\n• *Deliverables:* ${ready}\n\n*Review Phases:*\n${phasesText}\n\n${stageHelp}`;
      await api.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
      return;
    }

    case 'role': {
      // `/role pm` is the Project Manager's own surface (PM-1). It is answered
      // here, ahead of the generic role switch, because the PM is not a persona
      // to adopt — it is a cycle to run: project the fleet, climb the ladder,
      // nudge, record. See scripts/lib/pm-run.mjs for the whole implementation.
      if (cmd.args === 'pm' || cmd.args.startsWith('pm ')) {
        const sub = cmd.args.replace(/^pm\s*/, '').trim();
        const pm = await runPmCommand({
          sub,
          botId: config.id,
          chatId,
          operatorChatId: String(config.telegram?.allowedUserIds?.[0] || ''),
        });
        if (pm.resetRole) resetChatRole(chatId);
        await api.sendMessage(chatId, pm.text, { parse_mode: 'Markdown' });
        return;
      }
      const activeProj = getChatProject(chatId);
      const currentRoles = getProjectRoles(activeProj.id);
      if (!cmd.args) {
        // Bot-identity roles (this bot's registry row) live above the
        // per-chat project personas: `/role accountant` rewires the bot and
        // restarts it, while the names below only change this chat's persona.
        let botRoles = [];
        try {
          const catalog = loadRoles(rolesFileInUse());
          botRoles = Object.entries(catalog).map(([id, r]) => `• \`/role ${id}\` — *${r.label}* — ${r.blurb}`);
        } catch {
          botRoles = ['• (role catalog unreadable — bot-identity roles unavailable)'];
        }
        const rolesList = (currentRoles || []).map((r) => `• \`/role ${r.id.split('_')[0]}\` — *${r.name}*`).join('\n');
        // The whole explanation lives here: this listing is the one place every
        // role surface is named together, so a chat never has to guess how the
        // PM seat or a persona is taken, inspected, or left.
        const listedRole = checkRoleDetails(activeProj.id, getChatRole(chatId) || '')?.name || null;
        await api.sendMessage(
          chatId,
          [
            `🎭 *[Bot Identity Roles]*`,
            '',
            ...botRoles,
            '',
            `👥 *[Active Project Roles — ${activeProj.name}]*`,
            '',
            rolesList || '• None declared.',
            '',
            '*How roles work:*',
            `• This chat runs as: ${listedRole ? `*${listedRole}*` : '_general mode_'} (also on \`/status\` as \`role:\`)`,
            '• `/role accountant` — Rewire this bot into a role (bot restarts); `/role general` — back to a thin clone',
            '• `/role <name>` — Assume a role; later turns run under its mandate',
            '• `/role pm take` — Take the Project Manager seat (fleet, ladder, sheet, nudges)',
            '• `/role pm` — Fleet projection · `/role pm status` — read-only plus adopted role',
            '• `/role pm run` — One PM cycle: project, nudge, record · `/role pm sheet` — record rows now',
            '• `/role pm table` — Progress as a real table (rollup fence + sortable grid, per the telegram-tables skill)',
            '• `/role check <name>` — Inspect role mandate & instructions',
            '• `/role add <id> <name> : <instructions>` — Add a new dynamic role',
            '• `/role remove <id>` — Delete a role · `/role reset` — back to general mode',
          ].join('\n'),
          { parse_mode: 'Markdown' }
        );
        return;
      }
      // A bot-identity role rewires THIS BOT (registry row + restart), so it
      // outranks project personas and is only assignable in the bot's direct
      // chat by an allowlisted user. Anything else falls through to the
      // per-chat persona logic below, unchanged.
      if (!cmd.args.includes(' ')) {
        let botRole = null;
        try {
          botRole = resolveRole(loadRoles(rolesFileInUse()), cmd.args);
        } catch {
          botRole = null;
        }
        if (botRole) {
          if (kind !== 'direct') {
            await api.sendMessage(chatId, '🎭 Bot-identity roles are assigned in the bot\u2019s direct chat — a role rewires the whole bot, not just this group.');
            return;
          }
          if (!config.telegram?.allowedUserIds?.includes(Number(userId))) {
            await api.sendMessage(chatId, '🎭 Only an allowlisted user can assign a bot-identity role.');
            return;
          }
          const shapeFailures = validateRoleShape(botRole.id, botRole);
          if (shapeFailures.length) {
            await api.sendMessage(chatId, `🎭 Role "${botRole.id}" is misconfigured:\n- ${shapeFailures.join('\n- ')}`);
            return;
          }
          const target = validateRoleTarget(botRole);
          if (!target.ok) {
            await api.sendMessage(chatId, `🎭 Cannot assign *${botRole.label}* here: ${target.reason}.`);
            return;
          }
          const registryPath = registryFileInUse();
          let registry;
          try {
            // Raw rows, NOT the inheritance-merged view: writing a merged row
            // back would materialize every inherited leaf into this bot and
            // silently de-thin the clone. The role patch touches only its own
            // leaves; everything else stays inherited.
            registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
            if (!registry || !Array.isArray(registry.bots)) throw new Error('no "bots" array');
          } catch (err) {
            await api.sendMessage(chatId, `🎭 Cannot read the registry: ${String(err?.message || err).slice(0, 200)}`);
            return;
          }
          const row = (registry.bots || []).find((b) => b.id === config.id);
          if (!row) {
            await api.sendMessage(chatId, `🎭 This bot ("${config.id}") has no registry row, so there is nothing to assign the role to.`);
            return;
          }
          const changes = describeRoleChange(row, botRole, config.id);
          const next = applyRoleToRow(row, botRole, config.id);
          Object.keys(row).forEach((k) => delete row[k]);
          Object.assign(row, next);
          try {
            fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
          } catch (err) {
            await api.sendMessage(chatId, `🎭 Role computed but the registry write failed: ${String(err?.message || err).slice(0, 200)} — nothing changed.`);
            return;
          }
          await api.sendMessage(
            chatId,
            `🎭 *Role assigned: ${botRole.label}.*\n${changes.join('\n')}\n\nRestarting into the role now — I will be back in a few seconds.`,
            { parse_mode: 'Markdown' }
          );
          const restarted = await restartOwnUnit(config.id);
          if (!restarted.ok) {
            await api.sendMessage(chatId, `⚠️ Role is written but the automatic restart failed. Restart me with:\n\`${restarted.manual}\``);
          }
          return;
        }
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

    case 'health': {
      const projectId = 'external-health';
      // `sub` is the lowercased head for matching; the raw text is kept because
      // the literature lane's query is a sentence, not a keyword.
      const rawArgs = String(cmd.args || '').trim();
      const sub = rawArgs.toLowerCase();
      if (sub === 'verify') {
        if (running.get(chatId)) {
          await api.sendMessage(chatId, 'A task is already running. Please wait for it to finish before verifying the health data.');
          return;
        }
        await api.sendMessage(
          chatId,
          '🩺 *Running /health verify — re-reading the app (read-only) and diffing it against the sheet...*',
          { parse_mode: 'Markdown' },
        );
        try {
          const res = await runHealthVerify({ projectId });
          if (!res.ok) {
            // No parse_mode on the failure path: an error string is not ours to
            // format, and Telegram rejects a message whose markdown it cannot parse.
            await api.sendMessage(chatId, `❌ Verify could not run (${res.stage}): ${res.error}`);
            return;
          }
          await api.sendMessage(chatId, formatVerifyText(res.artifact), { parse_mode: 'Markdown' });
        } catch (err) {
          await api.sendMessage(chatId, `❌ Verify failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'ingest') {
        if (running.get(chatId)) {
          await api.sendMessage(chatId, 'A task is already running. Please wait for it to finish before the ingest.');
          return;
        }
        await api.sendMessage(chatId, '📥 *Reading the Brief folder (sheets + docs, read-only)...*', { parse_mode: 'Markdown' });
        try {
          const res = await runHealthIngest({ projectId, botId: config.id });
          if (!res.ok) {
            await api.sendMessage(chatId, `❌ Ingest could not run (${res.stage}): ${res.error}`);
            return;
          }
          const lines = [`📥 *Ingested into* \`${res.paths.sources}\``];
          for (const w of res.manifest.written) lines.push(`• \`${w.file}\` — ${w.kind}${w.tabs ? `, ${w.tabs} tabs` : ''}`);
          for (const s of res.manifest.skipped) lines.push(`• skipped ${s.name}: ${s.reason}`);
          lines.push('');
          lines.push('Run `/health verify` to diff the app against it.');
          await api.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
        } catch (err) {
          await api.sendMessage(chatId, `❌ Ingest failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'refresh') {
        if (running.get(chatId)) {
          await api.sendMessage(chatId, 'A task is already running. Please wait for it to finish before refreshing the documents.');
          return;
        }
        await api.sendMessage(
          chatId,
          '📄 *Refreshing the four documents — verify first, then publish into the project folder...*',
          { parse_mode: 'Markdown' },
        );
        try {
          const res = await runHealthRefresh({ projectId, botId: config.id });
          if (!res.ok) {
            await api.sendMessage(chatId, `❌ Refresh could not run (${res.stage}): ${res.error}`);
            return;
          }
          await api.sendMessage(chatId, formatRefreshText(res), { parse_mode: 'Markdown' });
        } catch (err) {
          await api.sendMessage(chatId, `❌ Refresh failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'dashboard' || sub === 'dash') {
        const ws = healthWorkspace(projectId);
        const dashPath = path.join(ws, 'result', 'HEALTH_DASHBOARD.md');
        let text = '';
        try {
          if (fs.existsSync(dashPath)) {
            text = fs.readFileSync(dashPath, 'utf8');
          } else {
            const status = getHealthStatus({ projectId });
            text = formatStatusText(status);
          }
        } catch (err) {
          await api.sendMessage(chatId, `❌ Failed to read health dashboard: ${err.message}`);
          return;
        }
        await sendChunked(api, chatId, text);
        return;
      }
      if (sub === 'triage' || sub.startsWith('triage')) {
        const target = rawArgs.replace(/^triage\s*/i, '').trim().toUpperCase();
        const ws = healthWorkspace(projectId);
        const verifyPath = path.join(ws, 'result', 'health-verify.json');
        let artifact = null;
        try {
          if (fs.existsSync(verifyPath)) {
            artifact = JSON.parse(fs.readFileSync(verifyPath, 'utf8'));
          }
        } catch { artifact = null; }

        if (target === 'H-1' || target === '1') {
          const lines = [
            '🛠️ *[Triage H-1: Profile Demographics Mismatch]*',
            '• *Brief Fact:* Male, Born 15 June 1983 (Age 43), Chinese ethnicity.',
            '• *Authoritative Sheet:* Height 163 cm, Weight 62 kg, BMI 23.49.',
            '• *Current D1 App Profile:* Age 28, Height 178 cm, Weight 74 kg (defaults).',
            '',
            '*Actionable Resolution Path:*',
            '1. Reconcile Cloudflare D1 app profile (`hiJun2hTdDTk2igwerun2LKvwb42`):',
            '   `UPDATE profiles SET date_of_birth = "1983-06-15", height = 163, weight = 62, gender = "male", ethnicity = "chinese" WHERE uid = "hiJun2hTdDTk2igwerun2LKvwb42";`',
            '2. Run `/health verify` to re-check. H-1 will flip to closed (✅).'
          ];
          await api.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
          return;
        }

        if (target === 'H-4' || target === '4') {
          const lines = [
            '🛠️ *[Triage H-4: Misfiled Biomarker Test Dates]*',
            '• *Issue:* 4 app rows carry lab values that belong to a different blood draw date.',
            '',
            '*Identified Misalignments:*',
            '• `2020-04-10` ➔ Belongs to `2020-11-04` draw.',
            '• `2024-04-01` ➔ Belongs to `2024-04-02` draw.',
            '• `2026-03-06` ➔ Belongs to `2024-04-03` / `2026-06-03` draw.',
            '• `2026-05-05` ➔ Belongs to `2026-06-03` / multiple draw dates.',
            '',
            '*Actionable Resolution Path:*',
            '1. In D1 database or via app edit, align row timestamps with the exact lab draw dates above.',
            '2. Run `/health verify` to verify clusters have cleared.'
          ];
          await api.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
          return;
        }

        if (target.startsWith('WAIVE') || target.startsWith('H-8')) {
          const lines = [
            '🛠️ *[Triage H-8 / Waiver Management]*',
            '• *H-8:* App holds telemetry newer than sheet (July–Sept 2026).',
            '• *Resolution:* Waive via `HEALTH_WAIVED_ITEMS=H-8` in context env or environment.',
            '• Once waived, the item state becomes `waived` (☑) and no longer blocks `/health analyze`.'
          ];
          await api.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
          return;
        }

        // General triage summary
        if (!artifact) {
          await api.sendMessage(chatId, '⚠️ No verify artifact found. Please run `/health verify` first to generate the triage backlog.');
          return;
        }
        const openItems = (artifact.fixList?.items || []).filter((i) => i.state === 'open');
        const lines = [
          '🩺 *[Data Gate Triage Overview]*',
          `Gate Status: *${openItems.length ? `🔴 OPEN (${openItems.length} items)` : '🟢 CLOSED'}*`,
          '',
          ...openItems.map((i) => `• *${i.id}:* ${i.title}\n  _${i.detail}_`),
          '',
          '💡 *Next Steps:*',
          '• Type `/health triage H-1` for demographics fix instructions.',
          '• Type `/health triage H-4` for misfiled date realignment instructions.',
          '• Type `/health dashboard` to view the comprehensive 5-section status board.'
        ];
        await sendChunked(api, chatId, lines.join('\n'));
        return;
      }
      if (sub === 'analyze') {
        // The producer takes a model turn, so it holds the running-guard the
        // other seat commands hold. A refusal — the gate open, no credential, a
        // payload the publisher would refuse — writes nothing and is reported
        // as the answer it is.
        if (running.get(chatId)) {
          await api.sendMessage(chatId, 'A task is already running. Please wait for it to finish before the analysis pass.');
          return;
        }
        await api.sendMessage(chatId, '📊 *Running /health analyze — one analyst turn, judged before it lands...*', { parse_mode: 'Markdown' });
        try {
          const res = await runHealthAnalyze({ projectId });
          await api.sendMessage(chatId, formatAnalyzeText(res), res.ok ? { parse_mode: 'Markdown' } : undefined);
        } catch (err) {
          await api.sendMessage(chatId, `❌ Analysis failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'readiness') {
        // Read-only and cheap: no running-guard, because this answers a question
        // about the host rather than starting work in the workspace.
        const { seatModelReach } = await import('./lib/health/seat-model.mjs');
        const modelReach = await seatModelReach();
        const res = checkHealthReadiness({ projectId, modelReach });
        await api.sendMessage(chatId, formatReadinessText(res), { parse_mode: 'Markdown' });
        return;
      }
      if (sub === 'research' || sub.startsWith('research ')) {
        // The literature lane's reach. It searches the declared provider chain,
        // fetches every hit, and records them in the workspace. A refusal — no
        // credential, or nothing returned — records nothing and is the answer,
        // because an empty log the seat could read as "no literature" is the
        // failure this lane exists to prevent.
        if (running.get(chatId)) {
          await api.sendMessage(chatId, 'A task is already running. Please wait for it to finish before running the research lane.');
          return;
        }
        await api.sendMessage(chatId, '🔎 *Running /health research — searching the declared provider chain and fetching every hit...*', { parse_mode: 'Markdown' });
        try {
          const query = rawArgs.replace(/^research\s*/i, '').trim();
          const res = await runHealthResearch({ projectId, queries: query ? [query] : [] });
          await api.sendMessage(chatId, formatResearchText(res), res.ok ? { parse_mode: 'Markdown' } : undefined);
        } catch (err) {
          await api.sendMessage(chatId, `❌ Research failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'link' || sub.startsWith('link ')) {
        // The four document links, from the workspace registry. A lookup, so it
        // is not under the running-guard (nothing is written and no lane is
        // called) and it needs no argument to be useful: `/health link` gives
        // all four, `/health link test plan` gives one and where the rest are.
        // Routed through answerHealthGroup so the command and the room's plain
        // "give me the link" are the same turn, not two readers of the registry.
        const ws = KNOWN_PROJECTS[projectId]?.workspace || KNOWN_PROJECTS['external-health'].workspace;
        const res = await answerHealthGroup({ mode: 'link', roleId: null, question: rawArgs.slice(4).trim(), workspace: ws });
        await api.sendMessage(chatId, res.text);
        return;
      }
      if (sub === 'doctor') {
        // The seat that checks the other seats. It writes only its own report;
        // a refusal (no credential, a report the checker refuses) writes
        // nothing and is reported as the answer it is.
        if (running.get(chatId)) {
          await api.sendMessage(chatId, 'A task is already running. Please wait for it to finish before the doctor review.');
          return;
        }
        await api.sendMessage(
          chatId,
          '🩺 *Running /health doctor — re-checking the analyst\u2019s claims against their receipts...*',
          { parse_mode: 'Markdown' },
        );
        try {
          const res = await runHealthDoctor({ projectId });
          await api.sendMessage(chatId, formatDoctorText(res), res.ok ? { parse_mode: 'Markdown' } : undefined);
        } catch (err) {
          await api.sendMessage(chatId, `❌ Doctor failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'tags') {
        await api.sendMessage(chatId, '🏷️ *Checking and synchronizing seat tags in Telegram...*', { parse_mode: 'Markdown' }).catch(() => {});
        try {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);
          // The creator-session credentials live in the host's own env files, never
          // in this repo. Read them at call time; refuse by name when absent.
          const hostEnv = {};
          for (const f of ['tui-gateway.env', 'common.env']) {
            try {
              for (const line of fs.readFileSync(path.join(os.homedir(), '.config', 'bot-host', f), 'utf8').split('\n')) {
                const m = line.match(/^(TELEGRAM_API_ID|TELEGRAM_API_HASH)=(.+)$/);
                if (m) hostEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
              }
            } catch { /* host may not have this file */ }
          }
          const apiId = process.env.TELEGRAM_API_ID || hostEnv.TELEGRAM_API_ID;
          const apiHash = process.env.TELEGRAM_API_HASH || hostEnv.TELEGRAM_API_HASH;
          if (!apiId || !apiHash) {
            await api.sendMessage(chatId, '❌ Seat tags need TELEGRAM_API_ID / TELEGRAM_API_HASH in ~/.config/bot-host/tui-gateway.env on this host.');
            return;
          }
          const { stdout, stderr } = await execFileAsync(
            process.execPath,
            [path.join(HERE, 'seat-tags.mjs'), '--apply', '--rights=change_info:true,view:true'],
            {
              env: { ...process.env, TELEGRAM_API_ID: apiId, TELEGRAM_API_HASH: apiHash },
              timeout: 30000,
            },
          );
          const clean = (stdout || stderr || 'All tags up to date.').replace(/\x1B\[[0-9;]*[mK]/g, '').trim();
          await api.sendMessage(chatId, `\`\`\`\n${clean}\n\`\`\``, { parse_mode: 'Markdown' })
            .catch(() => api.sendMessage(chatId, clean));
        } catch (err) {
          await api.sendMessage(chatId, `❌ Failed to sync seat tags: ${err.message}`);
        }
        return;
      }
      // Anything else (including no argument) is the status answer.
      const status = getHealthStatus({ projectId });
      await api.sendMessage(chatId, formatStatusText(status), { parse_mode: 'Markdown' })
        .catch(() => api.sendMessage(chatId, formatStatusText(status)));
      return;
    }

    case 'tax': {
      // Chiwah LTD tax (chiwah-tax/docs/BOT_PLAN.md). Thin dispatch: the bot
      // parses, calls the runner, formats the reply. Numbers are quoted from
      // engine artefacts — never computed here.
      const sub = (cmd.args || '').trim().toLowerCase().split(/\s+/)[0] || 'snapshot';
      if (!TAX_SUBS.includes(sub)) {
        await api.sendMessage(chatId, `Unknown /tax subcommand. Try: ${TAX_SUBS.join(' | ')}`);
        return;
      }
      if (running.get(chatId)) {
        await api.sendMessage(chatId, 'A task is already running. Please wait for it to finish before the tax pass.');
        return;
      }
      if (['snapshot', 'reconcile', 'losses', 'deadlines', 'saving', 'doc', 'gaps'].includes(sub)) {
        await api.sendMessage(chatId, `🧾 *Running /tax ${sub} — quoting engine results...*`, { parse_mode: 'Markdown' });
        try {
          const res = runTaxCommand({ sub });
          if (!res.ok) {
            await api.sendMessage(chatId, `❌ Tax ${sub} could not run (${res.stage}): ${res.error}`);
            return;
          }
          await api.sendMessage(chatId, res.text, { parse_mode: 'Markdown' });
        } catch (err) {
          await api.sendMessage(chatId, `❌ Tax ${sub} failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'status') {
        try {
          const res = runTaxStatus({});
          await api.sendMessage(chatId, res.text, { parse_mode: 'Markdown' });
        } catch (err) {
          await api.sendMessage(chatId, `❌ Tax status failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'sweep') {
        await api.sendMessage(chatId, '🧾 *Running /tax sweep (lite: gates + variance on current artefacts)...*', { parse_mode: 'Markdown' });
        try {
          const res = runTaxSweep({ lite: true });
          if (!res.ok) {
            await api.sendMessage(chatId, `❌ Sweep stopped (${res.stage}): ${res.error}`);
            return;
          }
          await api.sendMessage(chatId, res.text.slice(-3500), { parse_mode: 'Markdown' });
        } catch (err) {
          await api.sendMessage(chatId, `❌ Sweep failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'verify') {
        const res = runTaxVerify();
        await api.sendMessage(chatId, `❌ Verify not available (${res.stage}): ${res.error}`);
        return;
      }
      return;
    }
    case 'tell': {
      // B2B-1: one bounded message to one named seat. Everything about this is
      // refusal-first — an unresolvable target, an absent --ref or a tripped
      // bound all send nothing and say why in one line.
      const verdict = await sendPeerHandoff({ config, args: cmd.args || '' });
      await api.sendMessage(chatId, verdict.text);
      break;
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
          // Persisted per chat: the env var dies with this process, the pref
          // is reloaded on boot and re-applied to every later turn.
          setPref(prefs, chatId, { location: target });
          savePrefs(config.id, prefs);
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
          const machineLine = isLocalHost(target)
            ? ''
            : `\nworker: ${machineLabel(status.machine)}${status.standin ? ' — ⚠️ labeled stand-in (test worker, not the physical device)' : ''}`;
          await api.sendMessage(
            chatId,
            `✅ *Compute location set to:* \`${target}\`\n${status.reason}.${machineLine} The next turn runs on ${target}${isLocalHost(target) ? '' : ' — its first turn is a canary (checked, then confirmed as active)'}. Saved for this chat — it survives restarts.`
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

/**
 * Resolve a /freemodel keyboard tap to its annotated row (plan/TG_TOOL_SURFACE.md M4).
 *
 * A tap carries the button's route identity (`fm:<route>`), but terminal-only
 * rows are keyed with their vendor (`freebuff/deepseek/deepseek-v4.1-flash`)
 * while the button carries the vendorless route
 * (`deepseek/deepseek-v4.1-flash` — surface prefix stripped). Without the
 * suffix fallback the tap resolves to nothing and the chat gets "Expired, run
 * /freemodel again" instead of the terminal-only refusal. The fallback only
 * matches terminal-only rows, so a selectable row is never reached through
 * an ambiguous tap; exact matches always win.
 */
export function resolveFreemodelTap({ annotated = [], value } = {}) {
  const wanted = String(value || '').replace(/^❌\s*/, '').trim();
  const direct = (annotated || []).find(
    (a) => a.ref === value || a.laneLabel === wanted || a.label === wanted || a.ref === wanted,
  );
  if (direct) return { hit: direct };
  if (!wanted || wanted.startsWith('#')) return { hit: null };
  const terminal = (annotated || []).find(
    (a) => (a.terminalOnly || /^freebuff\//i.test(String(a.ref || '')))
      && (String(a.ref || '') === wanted || String(a.ref || '').endsWith(`/${wanted}`)),
  );
  return { hit: terminal || null };
}

async function handleCallback({ api, config, prefs, caches, running = null, query }) {
  // String once, at the boundary: Map keys written with the raw Telegram id
  // never match the same keys after a disk round-trip stringifies them, so
  // every restart silently forgot every chat's session until its next turn.
  const chatId = String(query.message?.chat?.id ?? '');
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
    if (kind === 'perm') {
      // Permission tap for a live run: resolve the watcher waiting on this
      // chat. A tap with no waiter is a stale keyboard from an ended run.
      const parsed = parsePermissionCallback(value);
      const waiter = running?.get(chatId)?.permWait;
      if (!parsed || !waiter || waiter.token !== parsed.token) {
        await api.answerCallbackQuery(query.id, { text: 'Expired — the run already moved on.' });
        return;
      }
      waiter.resolve(parsed.decision);
      await api.answerCallbackQuery(query.id, { text: parsed.decision });
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
        await api.answerCallbackQuery(query.id, { text: 'Expired, run a pool command again' });
        return;
      }
      // An already-shown model keyboard from a previous build. Typing /model is
      // now a pointer and does not set a model; this tap still applies the button
      // the reader already has on screen.
      setPref(prefs, chatId, { model, pool: null });
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
      // `.text`, not the whole result: this call site handed editMessageText the
      // return object, which Telegram renders as the literal "[object Object]" in
      // the body. Unreachable today (nothing builds a kind:'fmp' keyboard), but it
      // is the same /freemodel body and it was wrong.
      await api.editMessageText(chatId, messageId, formatFreemodelWithDepletion(entries, annotated, {
        current: eff.model,
        location: workLocation(),
      }).text, {
        parse_mode: 'HTML',
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
      const hit = byPosition || resolveFreemodelTap({ annotated: bundle.annotated || [], value }).hit;
      const entries = bundle.entries?.length ? bundle.entries : await getFreeModels(caches, config);
      const entry = hit
        ? entries.find((e) => e.ref === hit.ref) || hit
        : entries.find((e) => e.label === wanted || e.ref === value) || entries[Number(value)];
      if (!entry) {
        // Name a command that still exists AND opens the pool this chat is in: the
        // old name answers a pointer now, so telling a reader to run it would send
        // them to a menu they did not ask for.
        const expiredPool = effective(config, prefs, chatId).pool;
        await api.answerCallbackQuery(query.id, { text: `Expired, run /${poolCommand(expiredPool) || 'model_free'} again` });
        return;
      }
      const { table, session, dir } = getLedger(config.id);
      // The verdict, the reset and the next lane all come from the SAME
      // projection the keyboard and the table below are rendered from (the
      // annotation carries it); `isFreemodelEntryDepleted` is the
      // pre-projection check kept only as the fallback for a row the annotation
      // cannot resolve. Two verdicts for one lane is how a tap answered
      // "depleted" beside a row the table showed as usable, and how the notice's
      // reset printed its `-` placeholder beside a real countdown.
      const { annotated: annRows } = getAnnotatedFreeModels(caches, config.id);
      const annHit = annRows.find((a) => a.ref === entry.ref);
      const blocked = annHit
        ? Boolean(annHit.depleted)
        : Boolean(table && isFreemodelEntryDepleted(entry, table, session));
      if (blocked) {
        const route = freemodelRefToRoute(entry.ref);
        const readiness = hostReadiness(caches);
        const location = workLocation();
        // `projectLanes` with the host's readiness is what
        // buildAllowanceTextForBots renders its rows from, and `nextUsableLane`
        // is the picker behind that table's own Next up line — one answer, named
        // the same way, in both places.
        const projection = projectLanes(table, session, { now: Date.now(), location, readiness });
        const next = nextUsableLane({ table, session, rows: projection, provider: route.provider, model: route.model });
        await api.answerCallbackQuery(query.id, { text: `Depleted (${resetInBit(annHit?.resetIn)}) — pick ${next ? shortModelName(next) : 'another lane'}` });
        await sendHtml(api, chatId, `${depletedLaneProse({ label: annHit?.label || entry.label, resetIn: annHit?.resetIn, next })}\n\n${buildAllowanceTextForBots({ stateDir: dir, provider: route.provider, model: route.model, location, readiness })}`);
        return;
      }
      // Terminal-only rows (Freebuff) are shown for visibility but must not
      // become the chat's model: the keyboard never starts a headless turn
      // (plan/TG_TOOL_SURFACE.md M4). One reply, pref untouched.
      {
        const annHit = (bundle.annotated || []).find((a) => a.ref === entry.ref);
        if (annHit?.terminalOnly || /^freebuff\//i.test(String(entry.ref || ''))) {
          await api.answerCallbackQuery(query.id, { text: 'Terminal-only lane' });
          await api.sendMessage(chatId, 'Freebuff runs in the terminal — it cannot take a headless turn from chat. Your model is unchanged and nothing was spent.');
          return;
        }
      }
      // The constraint follows the last explicit action: a tap sets the model AND
      // re-derives the pool from the lane that was tapped, so a stale keyboard
      // cannot leave the chat's model and its pool disagreeing.
      setPref(prefs, chatId, { model: entry.ref, pool: poolOfRef(entry.ref) });
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
      // Gemini exposes none (single-shot lane): one refusal, nothing stored.
      if (ref.surface === 'gemini') {
        await api.answerCallbackQuery(query.id, { text: 'No levels on this model' });
        await api.editMessageText(chatId, messageId, 'This model has no thinking levels — /thinking does nothing here. Send a normal prompt instead.').catch(() => {});
        return;
      }
      let variants =
        ref.surface === 'cline' ? CLINE_THINKING_LEVELS : await getVariants(config, caches, eff.model);
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
 * Route-key fallback for the current-lane check: a stamped depleted route with
 * no table lane row (a catalog model the pref-doc table predates, or a spelling
 * the projection missed) must still displace. Without this the turn retries a
 * lane the ledger already knows is spent, every message until reset — live on
 * 2026-10-02, when `cline:cline-free/deepseek-v4.1-flash` was stamped depleted
 * yet every next turn announced it as the starting lane again. Returns a
 * skipped-shaped record, or null when no live stamp covers this route. Expired
 * stamps return null, so the lane is selectable again after renewal.
 */
export function routeKeySkipped({ model, current, session, now = Date.now() } = {}) {
  try {
    if (!model || !current?.provider || !current?.model) return null;
    const hit = liveRecForRoutes(routeCandidates(model), session || {}, now);
    if (!hit?.rec) return null;
    const untilMs = Number(hit.rec.depletedUntil || 0);
    const resetLabel = Number.isFinite(untilMs) && untilMs > 0
      ? defaultResetLabel(untilMs, hit.rec.countdownHint || '')
      : null;
    return {
      provider: current.provider,
      model: current.model,
      label: current.model,
      why: resetLabel ? `depleted until ${resetLabel}` : 'depleted',
      until: untilMs || null,
      resetLabel,
    };
  } catch {
    return null;
  }
}

/**
 * Sticky failover decision: the chat asked for `chatModel` but the answer came
 * from `answeredModel`. Returns the model the chat should stay on, or null when
 * nothing should change (same lane, no answer, or nothing to compare). The
 * caller persists the return value so the next turn starts on the working lane
 * instead of retrying a lane the ledger already knows is spent. Exported for
 * unit tests.
 */
export function stickyModelAfterTurn({ chatModel, answeredModel, answered }) {
  const from = String(chatModel || '');
  const on = String(answeredModel || '');
  if (!answered || !from || !on || on === from) return null;
  return on;
}

/**
 * Execution ref for a configured model. The OpenCode `google/` provider is
 * unavailable on hosts without a wired OpenCode google credential (live VPS:
 * every `google/gemini-*` attempt ends `Model unavailable`), while
 * GEMINI_API_KEY answers directly through the `gemini:` runner (pinged PONG
 * on vm3 2026-10-06). A raw `google/<id>` ref therefore never reaches the
 * CLI — it is rewritten to the direct runner. Every other surface passes
 * through untouched (unknown refs stay first-choice per the 2026-09-25 rule).
 * Idempotent: an already-direct `gemini:` ref has no `/`-prefix match.
 */
export function execModelRef(ref) {
  const raw = String(ref || '');
  const m = raw.match(/^(google|gemini)\/(.+)$/i);
  if (!m) return raw;
  const id = m[2].startsWith('gemini/') ? m[2] : `gemini/${m[2]}`;
  return `gemini:${id}`;
}

/**
 * Ping turns check exactly one lane. A bare greeting (`hi`) is rewritten into
 * a connectivity ping that must exercise the real turn path (session, model,
 * reply) — but walking the whole ledger on a ping turns one dead primary into
 * N switch lines for a turn the user never cared about (live vm3 2026-10-06:
 * `hi` walked longcat → gemini → qwen → glm → longcat, all hard-model-failure).
 * Returns the single-model chain for pings, null otherwise (caller keeps the
 * ledger walk for real prompts).
 */
export function pingOnlyModels({ isPingTurn, model, fallback } = {}) {
  if (!isPingTurn) return null;
  const single = [model || fallback].filter(Boolean);
  return single.length ? single : null;
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
export function selectTurnLanes({ botId, model, fallback, now = Date.now(), readiness = null, catalogEntries = null, pool = null } = {}) {
  const legacy = failoverModels(model, fallback);
  let ledger;
  try {
    ledger = loadFreeLaneLedger({ stateDir: ensureBotLedger(botId || 'default').dir, catalogEntries });
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
  const lanes = projection.filter((r) => r.selectable).map((r) => ({ provider: r.provider, model: r.model, pref: r.pref, family: r.family, label: r.label, plan: r.plan }));
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
  const currentSkipped = skipped.find(sameRoute) || routeKeySkipped({ model, current, session: ledger.session || {}, now });
  const fallbackLanes = lanes.filter((l) => !sameRoute(l));

  // Same-type first: a depleted Standard lane walks to the next usable Standard
  // lane in /freemodel order, a depleted Light lane to the next usable Light
  // lane. Within the tier the order is the list's order — rating first
  // (benchmark AA desc, catalog rank asc, pref asc) — because the list is
  // already sorted that way, the walk and the keyboard agree about what is
  // next. Only when its own tier is dry does the walk step across to another
  // tier (tier order, then rating): failing a turn outright while a lane of
  // the other pool sits free is worse than a weaker answer, and
  // `degradedToLight` says when a coding turn did exactly that.
  const currentGroup = (tierForModel(freemodelRefToRoute(model).model || model).tier) || 'unlisted';
  const tierOf = (l) => ((tierForModel(l.model).tier) || 'unlisted');
  const rateOf = (m) => freemodelRatingOf(m || '');
  const byRating = (a, b) => {
    const ra = rateOf(a.model);
    const rb = rateOf(b.model);
    if (rb.aa !== ra.aa) return rb.aa - ra.aa;
    if (ra.rank !== rb.rank) return ra.rank - rb.rank;
    return (Number(a.pref) || 0) - (Number(b.pref) || 0);
  };
  // Keyed (non-free) lanes are the last resort in every tier: they spend the
  // user's own key, so free lanes of any tier go first (live VM5 2026-10-03).
  const keyedRank = (l) => (l?.plan === 'GM' ? 1 : 0);
  const byTierThenRating = (a, b) => (keyedRank(a) - keyedRank(b)) || (walkTierRank(a.model) - walkTierRank(b.model)) || byRating(a, b);
  const bySameTier = (a, b) => (keyedRank(a) - keyedRank(b)) || byRating(a, b);
  // A chat that ran one of the three pool commands is CONSTRAINED to that pool
  // (decision D2): running the command sets the pool, not only the tap — a chat
  // that ran /model_light_free and then sent a message would otherwise still spend
  // a coding lane on the next quota hit. With no pool set this is byte-for-byte the
  // walk this function had before, so every /model user and every walk sensor keeps
  // passing unchanged.
  const poolOfRoute = (l) => poolOfLane({ provider: l?.provider, model: l?.model });
  const currentInPool = Boolean(pool) && Boolean(current.provider || current.model)
    && poolOfRoute({ provider: current.provider, model: current.model }) === pool;
  const poolLanes = pool
    ? [...fallbackLanes].filter((l) => poolOfRoute(l) === pool).sort(bySameTier)
    : [];
  let orderedLanes;
  if (pool === 'go') {
    // A paid lane never moves on its own: the chat's own Go lane when it has a
    // usable one, otherwise the pool's own first lane — and never a second entry.
    orderedLanes = currentInPool && !currentSkipped ? [] : poolLanes.slice(0, 1);
  } else if (pool) {
    // Inside the pool, only the list's own order: the cross-tier concat is gone,
    // because the other pool is no longer a fallback.
    orderedLanes = poolLanes;
  } else {
    orderedLanes = model
      ? [...fallbackLanes].filter((l) => tierOf(l) === currentGroup).sort(bySameTier)
        .concat([...fallbackLanes].filter((l) => tierOf(l) !== currentGroup).sort(byTierThenRating))
      : [...fallbackLanes].sort(byTierThenRating);
  }
  const codingLeft = orderedLanes.filter((l) => tierOf(l) === 'high').length;
  const lightLeft = orderedLanes.filter((l) => tierOf(l) === 'light').length;

  // An exhausted pool refuses the turn and names its OWN soonest reset (decision
  // D3): answering on the other pool and labelling it is exactly the across-pool
  // movement these pools exist to remove.
  if (pool && !orderedLanes.length && !(currentInPool && !currentSkipped)) {
    const soonest = soonestResetAmongDepleted(table, ledger.session || {}, { now, pool })
      || soonestResetAmongDepleted(table, ledger.session || {}, { now });
    return {
      models: [],
      skipped,
      fromLedger: true,
      exhausted: true,
      displaced: currentInPool ? (currentSkipped || null) : null,
      chose: null,
      pool,
      soonest,
    };
  }
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
  // The first entry executes, so it takes the execution ref: a raw `google/`
  // id would burn the turn on an unwired provider. Ledger identity above
  // (currentSkipped, groups) stays on the configured ref.
  if (model && !currentSkipped && (!pool || currentInPool)) models.push(execModelRef(model));
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
    pool,
    // A coding turn that can only be served by a light lane, and the chat's own
    // group, so the failover notice can say what happened instead of the reader
    // wondering why the answer got worse. A set pool has no such case: the chat
    // asked for that pool, so falling inside it is not a degradation to announce.
    currentGroup,
    degradedToLight: !pool && currentGroup === 'high' && codingLeft === 0 && unique.length > 1,
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

/**
 * Flag line for a turn that died mid-answer on one lane and completed on
 * another (QS-11). The partial answer is delivered, never dropped, and the
 * flag names the dead lane plus where the completion came from.
 */
export function midstreamFlagText({ partialText = '', deadLanes = [], continuedOn = '' } = {}) {
  const dead = [...new Set((deadLanes || []).map(String).filter(Boolean))].join(', ') || 'a lane';
  const head = String(partialText || '').trim();
  const tail = continuedOn ? `continued on \`${continuedOn}\` below` : 'no lane completed the answer';
  return `${head}${head ? '\n\n' : ''}⚠️ \`${dead}\` hit the free limit mid-answer — ${tail}.`;
}

/**
 * The short verdict a failover switch line carries.
 *
 * Every quota-class failure used to print the same two words — `free limit
 * hit` — because the only classification available was `isQuotaOrLimitError`,
 * whose vocabulary deliberately spans the whole billing surface (free-tier
 * allowance, an unfunded account, `capacity`, `throttled`, a bare 402). Live on
 * VM4 2026-10-07 that line read `free limit hit` for four hops in one cascade,
 * including lanes the user knew still had allowance, and the question it
 * produced was "is the quota really gone?" — which the line itself could not
 * answer. A wrong cause in a user-visible line is worse than no cause: it is the
 * line the person reasons from.
 *
 * So the wording names the failure the provider actually reported, and keeps the
 * exact phrase `free limit hit` for a genuine free-allowance exhaustion (the
 * common case, and the wording the QS-2 specimen asserts). The vendor's own
 * retry countdown rides along when it published one — that is what tells a
 * 40-minute throttle apart from a 22-hour daily cap.
 *
 * A transport failure and a hard model failure never reach here: the caller
 * only asks for this wording when `isQuotaOrLimitError` matched, so the two
 * other classifiers keep their own collapsed line.
 */
export function quotaVerdictShort(raw) {
  const text = String(raw || '');
  if (!text.trim()) return '';
  const hint = parseRetryAfter(text);
  const tail = hint ? ` (${hint})` : '';
  // Order matters: a free-tier cap can also carry a 429, and calling that a
  // throttle would understate a limit that will not lift for hours.
  if (/free[_\s-]?(tier|usage|limit)|daily free|free limit reached|subscribe to go|freebucks|free plan/i.test(text)) {
    return `free limit hit${tail}`;
  }
  if (/insufficient|out of credits|no credits|credit.?balance|payment required|no payment method|unfunded/i.test(text)) {
    return `account unfunded${tail}`;
  }
  if (/capacity|overloaded|over capacity|temporarily unavailable/i.test(text)) {
    return `provider at capacity${tail}`;
  }
  if (/throttl|rate.?limit|too many requests|\b429\b/i.test(text)) {
    return `rate limited${tail}`;
  }
  return `quota/limit hit${tail}`;
}

/**
 * The lane's plan code for a chat line: OC / CL / TH / CF / GM / OG / FB.
 * `planCodeForLane` reads a lane shape, so the ref is resolved back to its
 * provider + model first — the same resolution the `/allowance` rows use, which
 * keeps a chat line and the table from disagreeing about which lane ran.
 */
export function lanePlanCode(ref) {
  const { provider, model } = freemodelRefToRoute(String(ref || ''));
  if (!provider || !model) return '';
  return planCodeForLane({ provider, model });
}

/**
 * A switch-line lane name: the surface code, then `chatLaneName`.
 *
 * The code is what makes a Cline hop tellable from an OpenCode one at a glance.
 * `chatLaneName` strips the surface on purpose (there is no room for it in the
 * name column), so live on VM4 2026-10-07 the chain showed `glm-5.3-flash`,
 * `deepseek-v4.1-flash` and `solar-pro4` as bare names while all three were
 * Cline lanes, and the reasonable reading was "Cline was never tried". It had
 * been tried three times. The R16-QS2 capture of 2026-09-26 recorded those same
 * hops with the surface (`cline:cline-free/…`), so this restores that fact in a
 * shorter form rather than inventing a new one.
 *
 * The code also replaces the single prefix `chatLaneName` keeps: `OG
 * space-bunny-free` names the go-plan pool, which is separate quota from
 * `opencode/space-bunny-free` (OC), without the doubled
 * `opencode-go/space-bunny-free`.
 */
export function laneSwitchLabel(ref) {
  const code = lanePlanCode(ref);
  let name = chatLaneName(ref);
  if (code === 'OG') name = name.replace(/^opencode-go\//i, '');
  return code ? `${code} ${name}` : name;
}

export async function runOpencodeWithFailover({ api, config, chatId, prompt, models, runModel = null, onSwitchNotify, onAttemptStart, onAttemptComplete, isAborted = () => false, onCooldown = null, ...runArgs }) {
  let attempt = 0;
  // QS-11: partial answers from lanes that die mid-stream, in order. The chain
  // below empties each dead lane's text so failover continues; the pieces are
  // reattached to the final result for the flag line.
  const partialTexts = [];
  const midstreamDead = [];
  let lastModel = '';
  const { result } = await runWithModelFailover({
    models,
    makeRun: async (model) => {
      attempt += 1;
      lastModel = model;
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
      // QS-11: the model answered, then died with a quota signal mid-stream.
      // Treating the partial text as success would strand the rest of the
      // answer AND skip the ledger stamp (both key off empty text). Empty it
      // so the chain continues; the piece is kept above for the flag line.
      // The emptied result still flows through the normal stamp + dead-end
      // paths below, so a mid-stream death is recorded exactly once.
      const partialText = String(attemptResult?.finalText || '').trim();
      const partialErr = attemptFailureText(attemptResult);
      if (partialText && isQuotaOrLimitError(partialErr) && !isAborted()) {
        partialTexts.push(partialText);
        midstreamDead.push(model);
        attemptResult = { ...attemptResult, finalText: '' };
      }
      // A bare connectivity-probe echo (PONG) is not an answer: it
      // leaks in through the shared opencode session and must never be
      // delivered as the turn's reply. Empty it so the failover chain tries
      // the next lane; on the last lane the run surfaces as an error.
      // Never throws: a filter hiccup must not cost the chat its answer.
      try {
        const echoText = String(attemptResult?.finalText || '').trim();
        if (echoText && isUnpromptedProbeEcho(echoText, prompt) && !isAborted()) {
          console.log(`[${config?.id}] ${model} answered bare probe echo ${JSON.stringify(echoText.slice(0, 40))}; treating as no answer`);
          attemptResult = {
            ...attemptResult,
            finalText: '',
            lastError: `bare probe echo (${echoText.slice(0, 40)}) instead of an answer — nothing was computed, send your message again`,
          };
        }
      } catch {
        // fall through with the original attempt result
      }
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
      // A lane that answers "model unavailable" is neither quota (no 6h stamp)
      // nor transport (no retry — a second attempt cannot help). Without a
      // stamp the next turn walks straight back into the same dead lane, so
      // it gets the same short cooldown a connection failure does and the
      // walk skips it until the stamp expires.
      if (
        !String(attemptResult?.finalText || '').trim() &&
        !isQuotaOrLimitError(attemptFailureText(attemptResult)) &&
        !isConnectionFailure(attemptFailureText(attemptResult)) &&
        isHardModelFailure(attemptFailureText(attemptResult)) &&
        !isAborted()
      ) {
        const errText = attemptFailureText(attemptResult);
        const stamp = stampLaneCooldown({ botId: config?.id, model, errText, kind: 'model-unavailable' });
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
      // The switch IS the recovery attempt — record it so the error log shows
      // open→recovering→closed instead of open→closed with no trace of how.
      // A UI hiccup must never break failover, and neither must bookkeeping.
      try {
        noteLaneSwitch({ from, to, reason: raw, botId: config?.id });
      } catch {
        // fall through to the user-visible switch line
      }
      // Quota envelopes (Cline's INFERENCE_CAP_ERROR JSON) stay in the
      // ledger/observer log; the chat line carries the short verdict only.
      // Non-quota failures are one collapsed line, capped — never the raw
      // multi-line error with its model-id echo.
      //
      // The verdict names the failure the provider reported rather than calling
      // every quota-class error a free limit (`quotaVerdictShort`), and each
      // lane carries its surface code (`laneSwitchLabel`), so a Cline, Token
      // Harbor, Cloudflare or Gemini hop is tellable from the line itself.
      // Both are display-only: routing still uses the full ref.
      const short = isQuotaOrLimitError(raw)
        ? (quotaVerdictShort(raw) || 'quota/limit hit')
        : raw.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 120) || 'error';
      const line = `🔀 *${laneSwitchLabel(from)}* failed (${short.slice(0, 200)}) — switching to *${laneSwitchLabel(to)}*…`;
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
  if (partialTexts.length && result && typeof result === 'object') {
    result._partialText = partialTexts.join('\n\n');
    result._midstreamQuota = [...new Set(midstreamDead)];
    result._continuedOn = String(result?.finalText || '').trim() ? lastModel : '';
  }
  return result;
}

/**
 * Is a TUI attached to this conversation right now?
 *
 * PRESENCE, NOT A LOCK. tui-attach.sh publishes a lease with a heartbeat, and a
 * heartbeat older than TUI_LEASE_MAX_AGE_MS reads as gone, because a phone that
 * dies holding one must not leave a mark forever.
 *
 * This used to answer "is the TUI holding the conversation", and the answer
 * gated turns: while a terminal was merely *attached*, every chat message was
 * queued and no tool ran until the Mini App was closed. That is the opposite of
 * what /tui promises the user ("what you send here appears there"), and it made
 * opening the terminal stop all work.
 *
 * Why it is safe now: the TUI and the bot are not two writers on one file, they
 * are two clients of the SAME opencode service (neither passes --server, so
 * both go through the service manager) reading and writing the SAME session
 * through it. One server owns the state and serialises the turns, so a chat
 * turn and a prompt typed in the terminal are two turns on one conversation —
 * interleaved by the server, not racing it.
 *
 * Proven 2026-09-29 against a scratch server and a scratch session, so no live
 * conversation was touched: a TUI client attached with `--server <url> --session
 * <id> <dir>`, then `opencode run --server <same url> --session <same id>`
 * executed a turn. The TUI process survived, and the session history came back
 * as one coherent user -> assistant -> idle triple with no duplicate or
 * interleaved write. (That turn ended in a provider 429, which is a model
 * quota, not a concurrency fault — the write path is what was under test.)
 */
const TUI_LEASE_MAX_AGE_MS = 90_000;

function tuiLeasePath(botId) {
  return path.join(stateDir(botId), 'tui-lease.json');
}

function tuiPanePath(botId) {
  return path.join(stateDir(botId), 'tui-pane');
}

/**
 * The tmux session name the attach script last published for this bot.
 * Unlike the lease it survives detach, so a pane outliving its last client
 * stays closeable and reportable (live 2026-10-04: VM-tui-vm2 alive with no
 * lease after the Mini App detached, and /tui off answered "nothing to
 * close"). A name whose session is gone reads as already-closed, never live.
 */
export function readTuiPane(botId, stateRoot = null) {
  try {
    const file = stateRoot ? path.join(stateRoot, 'tui-pane') : tuiPanePath(botId);
    const name = String(fs.readFileSync(file, 'utf8') || '').trim();
    return name || null;
  } catch {
    return null;
  }
}

export function hasTuiPane(pane, tmux = defaultTmuxRunner) {
  if (!pane) return false;
  try {
    return Boolean(tmux(['has-session', '-t', pane]));
  } catch {
    return false;
  }
}

/** The `<surface>:<session>` mark tui-attach.sh wrote on its last run, or null. */
export function readTuiMark(botId) {
  try {
    const name = String(fs.readFileSync(path.join(os.tmpdir(), `tui-session-id-${botId}`), 'utf8') || '').trim();
    return name || null;
  } catch {
    return null;
  }
}

export function tuiIsAttached(botId, sessionId) {
  return Boolean(readTuiLease(botId, sessionId));
}

/**
 * The TUI lease, with its age resolved, or null when there is no live one.
 *
 * Returns the whole record because the caller needs more than a boolean: /status
 * has to name the pane and say how long it has been up, and /tui off has to know
 * WHICH pane to kill. The pane name is read from the lease rather than derived
 * from the bot id, because TUI_TMUX_NAME lives in the ttyd service file — the
 * bot has no other way to know it, and guessing `VM-tui-<id>` would drift from
 * the service the first time either changed.
 */
function readTuiLease(botId, sessionId) {
  let lease;
  try {
    lease = JSON.parse(fs.readFileSync(tuiLeasePath(botId), 'utf8'));
  } catch {
    return null; // no lease, or unreadable: nobody is attached
  }
  const heartbeat = Number(lease?.heartbeat || 0);
  if (!heartbeat || Date.now() - heartbeat > TUI_LEASE_MAX_AGE_MS) return null;
  const held = String(lease?.session || '');
  const wanted = String(sessionId || '');
  // The lease names its session and the caller names the turn's: attach only
  // when they are the same conversation. A lease with no session id is a
  // terminal on nothing shared (a pre-message tap that launched bare) — with
  // a turn session in hand that is NOT our terminal, so it must not trigger
  // the "same session" claim (live 2026-10-04: VM-tui-vm3 opened blank on ""
  // while the turn ran on ses_ef7b…, and the chat still promised both match).
  // With no turn session yet (status right after /new) any live lease counts.
  if (wanted && held !== wanted) return null;
  const since = Number(lease?.since || 0);
  return {
    session: held || null,
    pane: String(lease?.pane || '') || null,
    bot: String(lease?.bot || '') || null,
    clients: Number(lease?.clients || 0),
    since: Number.isFinite(since) && since > 0 ? since : null,
    heartbeat,
  };
}

/** "1d 0h47m" / "22m" / "40s" — coarse on purpose, it is a glance not a timer. */
function humanAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Close a TUI pane. Injected (fake) in tests, like the other tmux callers.
 *
 * `kill-session` and not `kill-pane`: the pane is the whole session here — one
 * window, one opencode client — so this is the same thing without leaving an
 * empty session behind to be reattached to.
 */
function killTuiPane(pane, tmux = defaultTmuxRunner) {
  return Boolean(tmux(['kill-session', '-t', pane]));
}

/** One line for /status: is a terminal open, which one, and is anyone in it. */
export function tuiStatusLine(botId, sessionId, tmux = defaultTmuxRunner, stateRoot = null) {
  const lease = readTuiLease(botId, sessionId);
  if (lease) {
    const who = lease.pane || 'unknown pane';
    const use = lease.clients > 0
      ? `${lease.clients} client${lease.clients === 1 ? '' : 's'} attached`
      : 'no client attached (pane kept for your place)';
    const age = lease.since ? ` · up ${humanAge(Date.now() - lease.since)}` : '';
    const sess = lease.session ? ` · ${lease.session.slice(0, 12)}…` : '';
    return `tui: ${who} · ${use}${age}${sess}`;
  }
  // No live lease: the pane may still be there, kept after detach. Report
  // that instead of "none open" so /tui off has something to close.
  const pane = readTuiPane(botId, stateRoot);
  if (pane && hasTuiPane(pane, tmux)) {
    return `tui: ${pane} · pane kept, nobody attached — /tui reopens it, /tui off closes it`;
  }
  return 'tui: none open (open one with /tui)';
}

/**
 * The health room's brief ask — "work on the brief", "update the documents".
 *
 * It is not a question for the seats and not a slash command: it runs the same
 * publisher `/health refresh` runs and the room gets the same reply. While the
 * gate is open the drafts publish and the analysis stays withheld — the refresh
 * already decides that, so there is no refusal line to add here. A refresh that
 * cannot run keeps its own stage and reason, and says nothing was invented.
 * `refresh` is injectable so the sensor can drive the turn with a fixture run.
 */
export async function answerBriefAsk({ projectId = 'external-health', botId = '', refresh } = {}) {
  const run = typeof refresh === 'function' ? refresh : () => runHealthRefresh({ projectId, botId });
  let res;
  try {
    res = await run();
  } catch (err) {
    return { answered: true, usedModel: false, text: `❌ Working the brief failed: ${err.message}`, fallbackReason: `brief failed: ${err.message}` };
  }
  if (!res?.ok) {
    return {
      answered: true,
      usedModel: false,
      text: `❌ The brief could not be worked (${res?.stage || 'unknown'}): ${res?.error || 'the publisher gave no reason'}`,
      fallbackReason: `brief refused: ${res?.stage || 'unknown'}`,
    };
  }
  return { answered: true, usedModel: false, text: formatRefreshText(res), markdown: true };
}

/**
 * Build and send one b2b envelope (B2B-1). Exported so the sensor can prove the
 * refusal paths without a network: every failure returns text that says what
 * stopped it, and sends nothing.
 */
export async function sendPeerHandoff({ config, args = '', api = null, stateDirPath = null, policy = undefined, peers = undefined, now = Date.now() } = {}) {
  const root = stateDirPath || path.join(HOME, '.local', 'state', 'bot-host');
  const peersMap = peers === undefined ? peersFromEnv() : peers;
  const resolvedPolicy = policy === undefined ? process.env.TG_SENDER_POLICY : policy;

  const refuse = (code, reason, extra = '') => ({
    ok: false,
    code,
    reason,
    text: `🤖↔️ not sent — ${reason}${extra}`,
    envelope: null,
  });

  const match = String(args).match(/^\s*(\S+)\s+([\s\S]+)$/);
  if (!match) {
    return refuse('BAD_ARGS', 'usage: /tell <bot> "<text>" --ref <ticket-key>');
  }
  const target = match[1].trim();
  let body = match[2].trim();
  const refMatch = body.match(/\s*--ref\s+(\S+)\s*$/);
  const ref = refMatch ? refMatch[1] : '';
  if (refMatch) body = body.slice(0, refMatch.index).trim();
  if (!ref) return refuse('NO_REF', 'a handoff must name tracked work: add --ref <ticket-key>');
  if (!body) return refuse('NO_BODY', 'nothing to say — /tell <bot> "<text>" --ref <ticket-key>');

  // Policy, peer resolution and every bound are decided inside sendPeerEnvelope,
  // so `/tell` and a peer-driven delegation cannot drift apart.
  return sendPeerEnvelope({
    config,
    to: target,
    kind: 'ask',
    ref,
    body,
    // A plain `/tell` starts its own conversation with that seat, exactly as it
    // always has. Chaining is opt-in and explicit — see sendPeerEnvelope.
    chainId: `tell:${config.id}:${target}`,
    api,
    root,
    peers: peersMap,
    policy: resolvedPolicy,
    now,
  });
}

/**
 * Put one envelope on the wire to a peer seat. This is the only function that
 * sends peer traffic, so every bound and every refusal is applied in one place
 * whether the sender was a human typing `/tell` or a peer whose turn just ended.
 *
 * `chainId` is the caller's to choose. `/tell` passes a fresh per-pair id; a
 * collaboration passes one id for every round, which is what keeps depth, turn
 * count and the terminal flag attached to the whole negotiation instead of
 * restarting at each hop.
 */
export async function sendPeerEnvelope({
  config,
  to,
  kind = 'ask',
  ref,
  body,
  chainId,
  replyTo = '-',
  api = null,
  root = null,
  peers = undefined,
  policy = undefined,
  now = Date.now(),
} = {}) {
  const stateRoot = root || path.join(HOME, '.local', 'state', 'bot-host');
  const peersMap = peers === undefined ? peersFromEnv() : peers;
  const resolvedPolicy = policy === undefined ? process.env.TG_SENDER_POLICY : policy;
  const target = String(to || '').trim();

  const refuse = (code, reason, extra = '') => ({
    ok: false,
    code,
    reason,
    text: `🤖↔️ not sent — ${reason}${extra}`,
    envelope: null,
  });

  if (!target) return refuse('BAD_ARGS', 'no peer seat named');
  if (!ref) return refuse('NO_REF', 'a handoff must name tracked work: add --ref <ticket-key>');
  if (!body) return refuse('NO_BODY', 'nothing to say');

  const verdict = sendVerdict({ policy: resolvedPolicy, peers: peersMap, from: config.id, to: target });
  if (!verdict.ok) {
    const extra = verdict.peers?.length ? `\n\naddressable peers: ${verdict.peers.join(', ')}` : '';
    return refuse(verdict.code, verdict.reason, extra);
  }

  const named = resolvePeerUsername(stateRoot, target);
  if (!named.ok) return refuse(named.code, `${named.reason} (${named.botId || target})`);

  // The chain id goes into the envelope BEFORE it is rendered. `checkSendBounds`
  // also sets it on the returned envelope, but by then the chat text has already
  // been built — and the text is what the peer's classifier reads, so a chain
  // that only existed on the local object would never reach the wire and every
  // reply would land in a fresh chain.
  const effectiveChain = String(chainId || `tell:${config.id}:${target}`);
  const built = encodeEnvelope({
    from: config.id,
    to: target,
    kind,
    ref,
    body,
    depth: 1,
    now,
    reply_to: replyTo,
    chain: effectiveChain,
  });
  if (!built.ok) return refuse(built.code, built.reason);

  // Root-relative, like the classifier's lookup: the caller owns the root, so a
  // test can never write into a live seat's state dir.
  const ledgerPath = path.join(stateRoot, config.id, 'handoff.json');
  const bounded = checkSendBounds({
    ledger: readJson(ledgerPath, emptyLedger()),
    edge: verdict.edge,
    now,
    chainId: effectiveChain,
    envelope: built.envelope,
  });
  if (!bounded.ok) {
    const file = deadLetter(deadLetterRoot(path.join(stateRoot, config.id)), {
      envelope: built.envelope,
      code: bounded.code,
      reason: bounded.reason,
      at: now,
    });
    return refuse(bounded.code, `${bounded.reason}${file ? '' : ' (dead-letter write also failed)'}`);
  }
  try {
    writeJson(ledgerPath, bounded.ledger);
  } catch (err) {
    return refuse('LEDGER_WRITE', `could not record the send: ${err.message}`);
  }

  // Where the bytes land. A private bot-to-bot chat has exactly two members —
  // the two bots — so a handoff sent there is invisible to the operator, which
  // is what "I didn't see anything on tg" turned out to mean. When
  // TG_B2B_GROUP_ID is set, the human's group is the transport instead; the
  // envelope still names the SEAT, so the receiving half is unchanged and a
  // group message and a private one are the same message.
  const groupId = String(process.env.TG_B2B_GROUP_ID || '').trim();
  const wireTo = groupId || named.username;
  const where = groupId ? `group ${groupId}` : `dm ${named.username}`;

  const telegram = api || new TelegramApi(resolveToken(config));
  try {
    const res = await telegram.call('sendMessage', {
      chat_id: wireTo,
      text: built.text,
      // LOUD by default. This started silent, on the reasoning that a handoff is
      // machine traffic and the operator does not want a buzz per message. Then
      // the operator asked to be aware of the traffic as it happens, and a
      // silent channel is indistinguishable from a broken one — three hops went
      // past unseen before that was noticed.
      //
      // The bounds are what keep this from becoming spam, not the mute: the
      // per-pair cooldown is 60s, so the worst case is one buzz per minute per
      // pair, and the global send budget still applies on top.
      // TG_B2B_NOTIFY=0 puts it back to silent without a deploy.
      disable_notification: String(process.env.TG_B2B_NOTIFY ?? '1') === '0' ? 'true' : 'false',
    });
    return {
      ok: true,
      code: 'SENT',
      envelope: bounded.envelope,
      messageId: res?.message_id ?? null,
      text: `📨 handed to ${wireTo} — ${ref} (depth ${bounded.envelope.depth}, id ${bounded.envelope.id}, via ${where})`,
    };
  } catch (err) {
    return refuse('SEND_FAILED', `${named.username}: ${err.message}`);
  }
}

/**
 * The peers map, from the environment. The registry is frozen for this packet,
 * and it is the right call anyway: peers are a *deployment* fact about which
 * seat may address which on this box, not a property of the bot.
 */
function peersFromEnv() {
  const raw = String(process.env.TG_PEERS_JSON || '').trim();
  if (!raw) return {};
  try {
    return normalizePeers(JSON.parse(raw));
  } catch (err) {
    console.error(`[b2b] TG_PEERS_JSON is not valid JSON, treating as empty: ${err.message}`);
    return {};
  }
}

/**
 * Bot-to-bot ingress (B2B-1). Decides what an update is BEFORE the
 * allowedUserIds gate, because that gate is a user-id check: once Telegram
 * delivers `from.is_bot=true` on the existing long-poll, a bot sender is
 * refused there and this code would never run.
 *
 * Three outcomes, and only the first may become a turn:
 *   human       — the ordinary path, untouched
 *   bot-handoff — a valid, in-bounds proposal from an allowlisted seat
 *   bot-refused — anything else, dead-lettered with the reason
 *
 * A bot-sourced update NEVER starts an agent turn. It files one line in the
 * location nudge inbox and returns. That is the whole loop defence on the
 * receive side: 20.6% of confirmed infinite-agentic-loop findings in real
 * projects are multi-agent chat without a turn bound.
 *
 * Exported for the sensor in tests/bot-host.test.ts — the classification is the
 * contract, not the plumbing.
 */
export function classifyInboundSender({ message, stateDirPath, self, policy, peers, ledger = emptyLedger(), now = Date.now() } = {}) {
  const from = message?.from;
  const type = senderTypeOf(from);
  if (type === null) return { kind: 'unknown', code: 'SENDER_UNKNOWN', reason: 'update has no sender id' };
  if (type === HUMAN) return { kind: 'human' };

  const resolvedPolicy = resolvePolicy(policy);
  if (resolvedPolicy === 'humans-only') {
    return {
      kind: 'bot-refused',
      code: 'POLICY_HUMANS_ONLY',
      reason: 'bot-to-bot is off for this seat (TG_SENDER_POLICY)',
    };
  }

  const seat = findSeatByUsername(stateDirPath, from?.username);
  if (!seat) {
    return {
      kind: 'bot-refused',
      code: 'SENDER_UNKNOWN_SEAT',
      reason: `no seat claims @${String(from?.username || '').replace(/^@/, '')}`,
    };
  }

  const verdict = receiveVerdict({ policy: resolvedPolicy, peers, from: seat.seat, to: self });
  if (!verdict.ok) {
    return {
      kind: 'bot-refused',
      code: verdict.code,
      reason: verdict.reason,
      seat: seat.seat,
      addressable: verdict.peers || [],
    };
  }

  const decoded = decodeEnvelope(message?.text || message?.caption || '');
  if (!decoded.ok) {
    return { kind: 'bot-refused', code: decoded.code, reason: decoded.reason, seat: seat.seat };
  }
  if (decoded.envelope.from !== seat.seat) {
    return {
      kind: 'bot-refused',
      code: 'FROM_MISMATCH',
      reason: `envelope claims from=${decoded.envelope.from} but the sender is ${seat.seat}`,
      seat: seat.seat,
    };
  }

  const bounded = checkReceiveBounds({ ledger, envelope: decoded.envelope, now, self, edge: verdict.edge });
  if (!bounded.ok) {
    return { kind: 'bot-refused', code: bounded.code, reason: bounded.reason, seat: seat.seat, envelope: decoded.envelope, ledger: bounded.ledger };
  }
  return {
    kind: 'bot-handoff',
    seat: seat.seat,
    envelope: bounded.envelope,
    ledger: bounded.ledger,
    edge: verdict.edge,
    // Whether this envelope was allowed to cost an agent turn, and whether this
    // round has now collected two agreements. Both are decided in the bounds,
    // not here, so no caller can widen them.
    spendsTurn: bounded.spendsTurn,
    converged: bounded.converged,
    round: bounded.round,
    turnsUsed: bounded.turnsUsed,
    maxTurns: bounded.maxTurns,
    maxRounds: bounded.maxRounds,
  };
}

/**
 * Run one delegated turn and hand the result to the peer.
 *
 * `handleMessage` is reused whole rather than reimplemented: the delegation gets
 * the same session, the same lane, the same model preference, the same progress
 * render and the same skill loading as a message the human typed. That is the
 * whole point — a peer's request must not be a lesser turn than the operator's.
 *
 * The synthetic message is attributed to the operator's own user id because that
 * is the id the seat's user gate checks, and because the work belongs in the
 * operator's chat. The PROVENANCE IS NOT FAKED: the prompt's first line says
 * plainly that this is not from the human, so the model is told the truth even
 * though the transport is the human's chat.
 */
export async function runDelegatedTurn({
  config,
  api,
  envelope,
  verdict,
  handleMessage,
  runContext = {},
  now = Date.now(),
} = {}) {
  const cfg = delegationConfig(process.env, { self: config.id });
  if (!cfg.ok) {
    console.warn(`[${config.id}] b2b delegation refused: ${cfg.reason}`);
    return { ok: false, code: cfg.code, reason: cfg.reason, text: '' };
  }

  // The chat the work belongs in: the operator's own private chat with this
  // seat. That is where the human reads it and where the finished letter lands.
  const operatorId = Number(config.telegram?.allowedUserIds?.[0] || 0);
  if (!operatorId) {
    return { ok: false, code: 'NO_OPERATOR', reason: 'seat has no allowedUserIds to run delegated work in', text: '' };
  }
  const chatId = String(operatorId);

  // One seat, one turn at a time per chat. A delegation that arrives while the
  // operator is mid-request waits rather than colliding with it — a lost turn
  // here would silently truncate the collaboration, which is worse than a wait.
  const busy = runContext.busy;
  const waitedFor = Date.now();
  while (busy?.has(chatId) && Date.now() - waitedFor < 90_000) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (busy?.has(chatId)) {
    console.warn(`[${config.id}] b2b delegation skipped: the operator's chat was still busy after 90s`);
    return { ok: false, code: 'CHAT_BUSY', reason: 'the operator chat stayed busy', text: '' };
  }

  const root = path.join(HOME, '.local', 'state', 'bot-host');
  let source = '';
  if (cfg.sheetId) {
    const src = await fetchDelegationSource({
      sheetId: cfg.sheetId,
      tabs: cfg.sourceTabs,
      cachePath: delegationSourcePath(root, cfg.sheetId),
      now,
    });
    source = src.ok ? src.text : '';
    console.log(`[${config.id}] b2b source material ${src.cached ? 'read from cache' : src.note}: ${source.length} chars`);
  }

  const turnsLeft = Math.max(0, (verdict.maxTurns || DEFAULTS.maxTurns) - (verdict.turnsUsed || 0));
  const prompt = delegationPrompt(envelope, {
    self: config.id,
    round: verdict.round || 1,
    turnsLeft,
    maxRounds: verdict.maxRounds || DEFAULTS.maxRounds,
    source,
  });

  console.log(
    `[${config.id}] b2b DELEGATED TURN from ${verdict.seat} kind=${envelope.kind} `
    + `ref=${envelope.ref} round=${verdict.round} turn=${verdict.turnsUsed}/${verdict.maxTurns}`,
  );

  // `delegation` is the capture slot: handleMessage writes the finished text
  // into it, so the host — not the model — decides what goes back on the wire.
  const capture = { text: '' };
  const synthetic = {
    message_id: envelope.id,
    date: Math.floor(now / 1000),
    chat: { id: operatorId, type: 'private' },
    from: { id: operatorId, is_bot: false, first_name: 'operator' },
    text: prompt,
  };

  try {
    await handleMessage({
      ...runContext,
      api,
      config,
      message: synthetic,
      // A delegated turn is not a follow-up of anything; keep it at depth 0 so
      // the follow-up queue cannot chain further turns off it.
      depth: 0,
      delegation: capture,
    });
  } catch (err) {
    console.error(`[${config.id}] b2b delegated turn failed: ${err.message}`);
    return { ok: false, code: 'TURN_FAILED', reason: err.message, text: '' };
  }

  const text = String(capture.text || '').trim();
  if (!text) {
    console.warn(`[${config.id}] b2b delegated turn produced no text; nothing sent to ${verdict.seat}`);
    return { ok: false, code: 'EMPTY_TURN', reason: 'the turn returned no text', text: '' };
  }

  const { agreed, letter } = readAgreement(text);
  const chainId = chainIdOf(envelope);

  // The host decides the reply kind. A turn that printed the verdict marker
  // becomes an `agree` (terminal); anything else is `feedback` back to the peer
  // for the next pass. The model cannot choose, and cannot send.
  const sent = await sendPeerEnvelope({
    config,
    to: verdict.seat,
    kind: agreed ? 'agree' : 'feedback',
    ref: envelope.ref,
    body: letter.slice(0, HANDOFF_DEFAULTS.maxBodyChars),
    chainId,
    replyTo: envelope.id,
    api,
    root,
  });

  console.log(
    `[${config.id}] b2b replied ${sent.ok ? sent.code : sent.code} to ${verdict.seat}: `
    + `kind=${agreed ? 'agree' : 'feedback'} round=${verdict.round} `
    + `${sent.ok ? '' : `(${sent.reason})`}`,
  );

  // Both flags in hand means both seats have agreed in this round. Only the
  // seat that receives the second agree can see this, which is exactly the seat
  // that should close the chain and deliver the letter.
  let converged = Boolean(verdict.converged);
  let delivered = null;
  if (agreed) {
    const ledgerPath = path.join(root, config.id, 'handoff.json');
    const led = readJson(ledgerPath, emptyLedger());
    const rec = led.chains?.[chainId] || {};
    converged = rec.peerAgree === rec.ourAgree && Boolean(rec.ourAgree);
  }
  if (converged) {
    delivered = await api.sendMessage(
      chatId,
      `🤝 **${config.id} and ${verdict.seat} agree** on \`${envelope.ref}\` after ${verdict.round} round(s).\n\n${letter}`,
      { parse_mode: 'Markdown' },
    ).then(() => true).catch((err) => {
      console.error(`[${config.id}] b2b agreement could not be delivered: ${err.message}`);
      return false;
    });
    console.log(`[${config.id}] b2b CONVERGED on ${envelope.ref} (round ${verdict.round}); letter ${delivered ? 'delivered' : 'NOT delivered'}`);
  }

  return { ok: sent.ok, code: sent.code || 'SENT', agreed, converged, delivered, text: letter, chainId };
}

/* ==================================================================== B2B-2 ===
 * DELEGATION: the one place a peer message is allowed to spend a model turn.
 *
 * WHAT IS DIFFERENT FROM EVERY OTHER PEER MESSAGE
 * -----------------------------------------------
 * `ask`, `answer`, `blocked` and `handoff-request` file a line in the inbox and
 * cost nothing. A `delegate` or a `feedback` instead runs a real agent turn on
 * this seat, because two seats that cannot hand work to each other are two
 * note-takers rather than two collaborators.
 *
 * WHY THAT IS SAFE ANYWAY
 * -----------------------
 * 1. Opt-in per seat. TG_B2B_DELEGATE is unset everywhere by default, and the
 *    policy still has to be humans-and-allowlisted-bots for a bot sender to get
 *    this far at all. Two independent switches, both off by default.
 * 2. The bounds were already applied before we get here. checkReceiveBounds has
 *    counted the turn, refused an over-budget chain and refused an over-round
 *    one; this function cannot start a turn the bounds did not permit.
 * 3. The MODEL NEVER TOUCHES THE WIRE. It writes text. This process wraps that
 *    text in an envelope, applies the send bounds, and sends. A model that
 *    ignores its instructions costs one turn and the chain stops — it cannot
 *    address a peer, forge a depth, or spend a second turn.
 * 4. The turn runs in the operator's own private chat with this seat, not in
 *    the group. So the human watches the work live, the final letter arrives
 *    where they read it, and a group message cannot be mistaken for a command.
 * 5. The collaboration peer is a fixed, declared pair — the same directed edge
 *    that had to exist for the message to be accepted at all — not anything
 *    the envelope names.
 */

/** The seat this one collaborates with, and whether delegation is on at all. */
export function delegationConfig(env = process.env, { self = '', peers = null } = {}) {
  const on = String(env.TG_B2B_DELEGATE || '').trim() === '1';
  const peer = String(env.TG_B2B_AUTO_PEER || '').trim();
  if (!on || !peer) return { ok: false, code: 'DELEGATE_OFF', reason: 'peer delegation is not enabled (TG_B2B_DELEGATE / TG_B2B_AUTO_PEER)' };
  const map = peers || peersFromEnv();
  // The peer must already be a declared edge. Re-checked here so a typo in the
  // environment fails at configuration time instead of at the first message.
  if (!map?.[self] || !map[self][peer]) {
    return { ok: false, code: 'TARGET_UNKNOWN', reason: `${self} has no declared edge to ${peer} in TG_PEERS_JSON` };
  }
  return {
    ok: true,
    peer,
    ref: String(env.TG_B2B_REF || 'b2b-collab').trim() || 'b2b-collab',
    sheetId: String(env.TG_B2B_SHEET || '').trim(),
    sourceTabs: String(env.TG_B2B_SOURCE_TABS || 'GP letter,Medical results').trim(),
  };
}

/**
 * The material both seats review, read ONCE and cached on disk.
 *
 * Two reviewers must argue about the same bytes. If each seat fetched the sheet
 * itself at a different moment they could end up reviewing different versions
 * and "we disagree" would really mean "we read different things" — a loop that
 * burns rounds on a phantom disagreement. So the host reads it, writes it once
 * with its content hash and modification time, and both turns read that file.
 *
 * A seat with no working Google credential is the failure this avoids: handed
 * only a link it would have produced a confident letter about a document it
 * never opened.
 */
export function delegationSourcePath(stateRoot, sheetId) {
  return path.join(stateRoot, 'b2b-source', `${String(sheetId).replace(/[^A-Za-z0-9_-]/g, '')}.md`);
}

/**
 * Read the named tabs of the sheet into one text block. Zero-burn on failure:
 * returns '' and logs, and the prompt then says plainly that no source was
 * available rather than pretending the reviewers had seen something.
 */
export async function fetchDelegationSource({ sheetId, tabs = '', cachePath = '', ttlMs = 900_000, now = Date.now() } = {}) {
  if (!sheetId) return { ok: true, text: '', cached: false, note: 'no sheet configured' };
  try {
    const stat = fs.statSync(cachePath);
    if (now - stat.mtimeMs < ttlMs) {
      return { ok: true, text: fs.readFileSync(cachePath, 'utf8'), cached: true, note: 'from cache' };
    }
  } catch { /* no cache yet */ }

  try {
    const { loadHostEnv, identityFromEnv, accessToken, SCOPES } = await import('./lib/google-store.mjs');
    const { env } = loadHostEnv('b2b-collab');
    const who = identityFromEnv(env);
    if (!who.ok) return { ok: false, note: who.reason || 'no Google identity on this host' };
    const tok = await accessToken(who, { scopes: Object.values(SCOPES) });
    if (!tok?.ok || !tok.token) return { ok: false, note: tok?.error || 'could not mint a Google token' };
    const auth = { authorization: `Bearer ${tok.token}` };
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=${encodeURIComponent('properties,sheets.properties')}`, { headers: auth });
    const meta = await metaRes.json();
    if (!metaRes.ok) return { ok: false, note: JSON.stringify(meta).slice(0, 200) };
    const available = (meta.sheets || []).map((x) => x.properties.title);
    const wanted = String(tabs || '').split(',').map((t) => t.trim()).filter(Boolean);
    const chosen = wanted.length ? wanted.filter((t) => available.includes(t)) : available;
    const chunks = [`# ${meta.properties?.title || sheetId} (read ${new Date(now).toISOString()})`];
    for (const tab of chosen) {
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(tab)}`, { headers: auth });
      const v = await r.json();
      if (!r.ok) { chunks.push(`\n## ${tab}\n(unreadable)`); continue; }
      chunks.push(`\n## ${tab}`);
      for (const row of (v.values || [])) {
        // One quoted CSV line per cell is how this sheet stores a table; join on
        // a visible separator so a reviewer can still read the columns.
        chunks.push(row.map((c) => String(c ?? '').replace(/\s*\n\s*/g, ' ⏎ ')).join(' | '));
      }
    }
    const text = chunks.join('\n');
    if (cachePath) {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, text, 'utf8');
    }
    return { ok: true, text, cached: false, note: 'fetched' };
  } catch (err) {
    return { ok: false, note: String(err?.message || err).slice(0, 200) };
  }
}

/**
 * Run one bot-sourced update: persist the ledger, dead-letter a refusal, and
 * file the proposal. Returns the classification so the caller can log it.
 */
async function handlePeerHandoff({ config, message, verdict, runDelegation = null } = {}) {
  const dir = stateDir(config.id);
  const deadLetterDir = deadLetterRoot(dir);
  try {
    writeJson(path.join(dir, 'handoff.json'), verdict.ledger);
  } catch (err) {
    console.error(`[${config.id}] b2b ledger write failed: ${err.message}`);
  }

  if (verdict.kind === 'bot-refused') {
    const file = deadLetter(deadLetterDir, {
      envelope: verdict.envelope || null,
      code: verdict.code,
      reason: verdict.reason,
    });
    console.warn(
      `[${config.id}] b2b refused ${verdict.code}${verdict.seat ? ` from ${verdict.seat}` : ''}: ${verdict.reason}`
      + `${file ? ` -> ${file}` : ' (dead-letter write failed)'}`,
    );
    return verdict;
  }

  // A `delegate` or a `feedback` is the B2B-2 exception: it may start a real
  // agent turn, but only after the bounds above have counted and permitted it,
  // and only when the seat has delegation switched on. Everything else — and
  // everything else still, if delegation is off — lands here as a proposal.
  if (runDelegation && TURNS_KINDS.includes(String(verdict.envelope?.kind))) {
    const result = await runDelegation({ config, message, verdict });
    if (result?.ok !== false || result?.code !== 'DELEGATE_OFF') {
      return { ...verdict, delegation: result };
    }
    console.warn(`[${config.id}] b2b ${result.code} for ${verdict.envelope?.kind}; filing as a proposal instead`);
  }

  // A proposal, not a turn. The owning seat decides; this process does not act.
  const inbox = path.join(os.homedir(), '.agents', 'nudges', `inbox-${machineLocation()}.md`);
  const line = proposalLine(verdict.envelope, { self: config.id });
  try {
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    fs.appendFileSync(inbox, `${line}\n`, 'utf8');
    console.log(`[${config.id}] b2b proposal from ${verdict.seat} ref ${verdict.envelope.ref} in chat ${message?.chat?.id ?? '?'} -> ${inbox}`);
  } catch (err) {
    console.error(`[${config.id}] b2b proposal could not be filed: ${err.message} (envelope ${verdict.envelope.id})`);
  }
  return verdict;
}

async function handleMessage({ api, config, throttle, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, busy, message, depth = 0, delegation = null }) {
  // Bot-to-bot first: a bot sender must be classified before the user-id gate,
  // which would otherwise drop it silently and leave the operator guessing.
  if (senderTypeOf(message?.from) === BOT) {
    const verdict = classifyInboundSender({
      message,
      stateDirPath: path.join(HOME, '.local', 'state', 'bot-host'),
      self: config.id,
      policy: process.env.TG_SENDER_POLICY,
      peers: peersFromEnv(),
      ledger: readJson(path.join(stateDir(config.id), 'handoff.json'), emptyLedger()),
    });
    await handlePeerHandoff({
      config,
      message,
      verdict,
      runDelegation: (ctx) => runDelegatedTurn({
        ...ctx,
        api,
        handleMessage,
        runContext: { throttle, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, busy },
      }),
    });
    return;
  }
  // Same boundary rule as handleCallback: one String type for chat ids
  // everywhere downstream, so disk round-trips stop invalidating sessions.
  const chatId = String(message.chat.id);
  const userId = Number(message.from?.id);
  if (!config.telegram.allowedUserIds.includes(userId)) {
    console.warn(`[${config.id}] ignored message from unauthorized user ${userId}`);
    return;
  }
  // Five bots can share one group only if each answers solely when addressed.
  // Direct chats skip this entirely: everything there is for this bot.
  let fleetBots = [];
  try {
    fleetBots = loadRegistry(registryFileInUse()).bots;
  } catch {
    fleetBots = [];
  }
  const dedicatedRoleIds = [
    ...dedicatedHealthRoleIds(fleetBots),
    ...dedicatedTaxRoleIds(fleetBots),
  ];
  const taxWorkspace = KNOWN_PROJECTS[TAX_PROJECT_ID].workspace;
  const deskId = taxDeskBotId(fleetBots, 'vm');
  const isTaxDesk = config.id === deskId;
  const myRoles = [config.agent?.healthRole, config.agent?.taxRole].filter(Boolean);
  // The tax desk is a coordinator in its own supergroup, the same way vm is
  // the coordinator for the health seats. Both can be admins of one group;
  // the chat binding decides which council a bare question belongs to.
  const isMasterBot = config.id === 'vm' || Boolean(config.isMaster) || isTaxDesk;
  const addr = resolveGroupAddressing(message, config.me, {
    role: myRoles[0] || config.role || config.agent?.role || null,
    roles: myRoles,
    name: config.name,
    isMaster: isMasterBot,
    allowGroupBroadcast: true,
    hasDedicatedRoleBots: dedicatedRoleIds.length > 0,
    dedicatedRoleIds,
  });
  if (chatKind(message) === 'group' && !addr.addressed) {
    return;
  }
  if (addr.delayMs && addr.delayMs > 0) {
    await new Promise((r) => setTimeout(r, addr.delayMs));
  }
  let text = (addr.cleanText || message.text || message.caption || '').trim();
  // Menu-tapped skills arrive underscored (/do_github_sync — Telegram forbids
  // hyphens in commands). Restore the hyphen form before anything parses, so
  // a tap behaves exactly like the typed line.
  text = normalizeSkillCommand(text);
  const hasMedia = selectInboundMedia(message).length > 0;
  if (!text && !hasMedia) return;

  const cmd = text ? parseCommand(text) : null;
  // A leading `/` that is not a bot command is NOT a command: it falls
  // through to the turn path as the user prompt (plan/TG_TOOL_SURFACE.md M3).
  // That is how typed `/do-*` skills reach the tool. Bot commands win.
  const route = cmd ? resolveCommandName(cmd) : null;
  if (cmd && isKnownCommand(route)) {
    await handleCommand({ api, config, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, chatId, cmd: { ...cmd, name: route }, userId, kind: chatKind(message) });
    return;
  }

  // Bare greetings become a one-word connectivity ping, not smalltalk and
  // not a canned reply: the operator uses "hi" to check the whole chain is
  // alive, so it must exercise the real turn path (session, model, reply) —
  // cheaply, with no tools and an exact echo to check against. A static
  // auto-reply would prove nothing; the raw greeting invites a rambling
  // turn. Group rooms keep existing behavior; media takes the normal path.
  // Connectivity pings run on a throwaway session: their scaffolding must
  // never land in the chat's transcript or the TUI (declared here, ahead of
  // use — a later `let` would be a temporal-dead-zone throw on every ping).
  let isPingTurn = false;
  if (chatKind(message) !== 'group' && !hasMedia && greetingReply(text)) {
    text = `[connectivity ping for ${JSON.stringify(text.trim())}: reply with exactly PONG, no tools]`;
    isPingTurn = true;
  }

  // A named health seat, or a bare question to the room, is answered here.
  // It does not fall through to the website coder: that turn can edit the
  // repo and does not see the verify artifact. One model call answers the
  // question. A room question is one joint answer. A named seat answers that
  // question. The other bots stay quiet.
  const storedProjectId = getChatProject(chatId).id;
  // The tax desk's home is the tax supergroup. A chat that has never been
  // switched still looks like health-tracker, and this bot must not answer
  // that room as the health council.
  const deskHome = isTaxDesk
    && config.agent?.homeProject === TAX_PROJECT_ID
    && storedProjectId === 'health-tracker';
  const taxChat = storedProjectId === TAX_PROJECT_ID || isTaxGroupChat(taxWorkspace, chatId) || deskHome;
  // The lane this chat would use for a normal message: the /model pref, then the
  // bot's registry default. Read once here so the health seats below answer on the
  // same model the user picked for this chat instead of a lane chosen elsewhere.
  const eff = effective(config, prefs, chatId);
  const healthTurn = classifyHealthGroupTurn({
    kind: chatKind(message),
    addr,
    text,
    projectId: storedProjectId,
    taxChat,
  });
  if (healthTurn?.mode === 'skip') return;
  if (healthTurn) {
    if (busy.has(chatId)) {
      await api.sendMessage(chatId, 'Still working through the seats. Ask again when that answer is in the chat.');
      return;
    }
    busy.add(chatId);
    const workspace = KNOWN_PROJECTS['external-health'].workspace;
    // A link ask is a registry lookup: no seats, no lane, no typing indicator,
    // and nothing to wait for. It is answered and posted here, and the guard is
    // released immediately because no turn is occupying the room — which is also
    // why it is not turned away by one that is. Purely additive: the seat path
    // below is untouched.
    if (healthTurn.mode === 'link') {
      busy.delete(chatId);
      const linkReply = await answerHealthGroup({ ...healthTurn, workspace });
      if (linkReply?.text) await api.sendMessage(chatId, linkReply.text).catch(() => {});
      return;
    }
    console.log(`[${config.id}] health group ${healthTurn.mode}${healthTurn.roleId ? ` ${healthTurn.roleId}` : ''}`);
    let reply;
    let typing;
    // The winning lane's measured usage for this turn. The council path has
    // no coder turn, so without this accumulator the seat's per-chat Usage
    // stays — forever no matter how much it talks in the room.
    const seatUsage = { tokens: 0, cost: 0, model: '' };
    try {
      if (healthTurn.mode === 'brief') {
        // A brief ask is not a question for the seats: it runs the publisher,
        // under the same busy guard, and the room gets the refresh reply.
        await api.sendMessage(
          chatId,
          '📄 *Working on the brief — verify first, then update the four documents in place...*',
          { parse_mode: 'Markdown' },
        ).catch(() => {});
        reply = await answerBriefAsk({ projectId: 'external-health', botId: config.id });
      } else {
        const artifact = readHealthVerify(workspace);
        const gate = artifact && gateFromArtifact(artifact);
        if (gate?.total > 0 && typeof api.sendChatAction === 'function') {
          const ping = () => {
            const pending = api.sendChatAction(chatId, 'typing');
            if (pending && typeof pending.catch === 'function') pending.catch(() => {});
          };
          ping();
          typing = setInterval(ping, 4000);
          typing.unref?.();
        }
        reply = await answerHealthGroup({
          ...healthTurn,
          workspace,
          runModel: async ({ prompt }) => {
            // The seat runs on the lane *this chat* already uses. `eff` is the
            // same resolution a normal message in this chat gets: the /model
            // pref, then the bot's registry default. A seat is not a separate
            // species of agent, so if the user set this chat to a model the
            // analyst answers on it — and if that lane is dead, the bot default
            // is the fallback, exactly as `failoverModels` does elsewhere.
            const { runSeatModel } = await import('./lib/health/seat-model.mjs');
            const res = await runSeatModel({
              prompt,
              chatModel: eff.model,
              botModel: config.agent.model,
              timeoutMs: 120000,
            });
            try {
              const t = Number(res?.usage?.tokens?.total ?? res?.usage?.tokens) || 0;
              const c = Number(res?.usage?.cost) || 0;
              if (t > 0 || c > 0) {
                seatUsage.tokens += t;
                seatUsage.cost += c;
                if (!seatUsage.model && res?.answeredBy) seatUsage.model = res.answeredBy;
              }
            } catch {}
            const out = String(res?.finalText || '').trim();
            if (!out) throw new Error(res?.lastError || 'the model returned no text');
            return out;
          },
        });
      }
    } catch (err) {
      await api.sendMessage(chatId, `The health seats did not finish: ${err.message}`).catch(() => {});
      return;
    } finally {
      if (typing) clearInterval(typing);
      busy.delete(chatId);
    }
    if (reply?.fallbackReason) {
      console.log(`[${config.id}] health group ${healthTurn.mode}${healthTurn.roleId ? ` ${healthTurn.roleId}` : ''} fell back: ${reply.fallbackReason}`);
    }
    if (reply?.text) {
      await api.sendMessage(chatId, reply.text, reply.markdown ? { parse_mode: 'Markdown' } : undefined).catch(() => {});
      // Persist this turn beside the cumulative chat totals, the same record
      // the coder path keeps: without it /status_all can only show — for a
      // seat that answers in this room every day. A council answer is a
      // stateless one-shot and the lane reports no token events for it
      // (verified against the live CLI), so this is usually runs-only until
      // the lane measures more; the snapshot (agent, limit, timestamp) is
      // still kept for the compaction question.
      try {
        await noteUsage({
          chatId,
          result: { usage: { tokens: { total: seatUsage.tokens }, cost: seatUsage.cost } },
          eff: { ...eff, model: seatUsage.model || eff.model },
          config,
          caches,
          totals,
          lastUsage,
        });
      } catch {}
    }
    if (reply?.answered) {
      if (healthTurn.mode === 'seat') forgetTaxGroup(taxWorkspace, chatId);
      recordActiveThread(chatId, {
        roleId: healthTurn.roleId || null,
        botId: config.me?.id || config.id,
        isCouncil: healthTurn.mode === 'council',
        jointRoles: addr?.jointRoles || [],
        timestamp: Date.now(),
      });
    }
    return;
  }

  // Same shape as the health room, for the tax seats. A named seat answers
  // alone. A bare question in the tax supergroup is one consolidated reply
  // after the accountant and the verifier, in that order. No slash command.
  const taxProjectId = deskHome ? TAX_PROJECT_ID : storedProjectId;
  const taxHome = taxProjectId === TAX_PROJECT_ID || taxChat;
  const taxTurn = classifyTaxGroupTurn({
    kind: chatKind(message),
    addr,
    text,
    projectId: taxProjectId,
    taxChat: taxHome,
    isDesk: isTaxDesk,
  });
  if (taxTurn?.mode === 'skip') return;
  if (taxTurn) {
    if (busy.has(chatId)) {
      await api.sendMessage(chatId, 'Still working through the tax seats. Ask again when that answer is in the chat.');
      return;
    }
    busy.add(chatId);
    console.log(`[${config.id}] tax group ${taxTurn.mode}${taxTurn.roleId ? ` ${taxTurn.roleId}` : ''}`);
    let reply;
    try {
      // A seat mention answers in any room without binding it: only the
      // desk's room answer makes this chat a tax supergroup. Otherwise one
      // @accountant mention in the health room would steal its bare questions.
      if (taxTurn.mode === 'council') rememberTaxGroup(taxWorkspace, chatId);
      reply = answerTaxGroup({
        ...taxTurn,
        workspace: taxWorkspace,
        snapshot: readTaxSnapshot(taxWorkspace),
      });
    } catch (err) {
      await api.sendMessage(chatId, `The tax seats did not finish: ${err.message}`).catch(() => {});
      return;
    } finally {
      busy.delete(chatId);
    }
    if (reply?.text) await api.sendMessage(chatId, reply.text).catch(() => {});
    if (reply?.answered) {
      recordActiveThread(chatId, {
        roleId: taxTurn.roleId || null,
        botId: config.me?.id || config.id,
        isCouncil: taxTurn.mode === 'council',
        jointRoles: addr?.jointRoles || [],
        timestamp: Date.now(),
      });
    }
    return;
  }
  if (chatKind(message) === 'group' && addr.isBroadcast && taxHome && !isTaxDesk) return;
  if (chatKind(message) === 'group' && addr.isBroadcast && isTaxDesk && config.id !== 'vm' && !taxHome) return;

  if (busy.has(chatId)) {
    // Direct phone interaction: a message sent mid-run queues as a follow-up
    // turn instead of being rejected. Commands still run (handled above)
    // while the queue stays queued.
    if (hasMedia) {
      await api.sendMessage(chatId, 'Still working — photos/files cannot queue, please resend them when this turn finishes.');
      return;
    }
    if (!text) return;
    const pos = queueFollowup(chatId, text);
    if (pos == null) {
      await api.sendMessage(chatId, `Follow-up queue is full (${MAX_FOLLOWUPS}). Wait for the current run to finish, then try again.`);
      return;
    }
    await api.sendMessage(chatId, `⏳ Queued as follow-up #${pos} — runs when the current turn finishes (the queue stays).`);
    return;
  }

  // A TUI attached to this same conversation does NOT stop a turn.
  //
  // This block used to defer every message while the terminal was open, queue it
  // as a follow-up, and run nothing until the Mini App was closed — so opening
  // the TUI silently disabled the bot. The deferral is gone because the premise
  // behind it is false: the TUI and the bot are two clients of the same opencode
  // service, driving the same session through it, and the server serialises the
  // writes. See tuiIsAttached for the probe that established it.
  //
  // Presence is still read, and used for one thing only: a note that this turn
  // is visible in the terminal. That is not decoration — without it a turn that
  // also renders in the TUI looks like the bot ran something twice.
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

  // Lane preflight, before the turn starts (plan/TG_TOOL_SURFACE.md M4).
  // Freebuff is terminal-only (laneSupports('freebuff','headless') === false):
  // the model keyboard must not start a headless turn. Cline cannot load the
  // opencode `/do-*` skill library. Each is one recorded refusal: no session
  // is burned and no turn runs. Gemini `/do-*` is run as a normal prompt.
  {
    const laneEff = effective(config, prefs, chatId);
    const laneRef = parseModelRef(laneEff.model);
    const lane = laneRef.surface === 'cline' ? 'cline' : laneRef.surface === 'gemini' ? 'gemini' : 'opencode';
    if (/^freebuff\//i.test(String(laneEff.model || ''))) {
      try { releaseFiles(claimed, claimId); } catch {}
      await api.sendMessage(chatId, 'Freebuff runs in the terminal — it cannot take a headless turn from chat. No session was started and nothing was spent. Pick another lane with /model_free.');
      return;
    }
    if (lane === 'cline' && /^\/do[-_][a-z]/i.test(String(text || '').trim())) {
      try { releaseFiles(claimed, claimId); } catch {}
      await api.sendMessage(chatId, 'Cline cannot load that skill — it runs without the opencode skill library, so this text was not run and nothing was spent. Switch lane with /model, or run it in the terminal. (Cline’s screen is its own thread, not this chat.)');
      return;
    }
  }

  // A TUI attached to this same conversation does NOT stop a turn.
  //
  // This used to defer every message while the terminal was open, queue it as a
  // follow-up, and run nothing until the Mini App was closed — so opening the
  // TUI silently disabled the bot, the opposite of what /tui promises. The
  // deferral is gone because its premise is false: the TUI and the bot are two
  // clients of the same opencode service driving the same session through it,
  // and the server serialises the turns. See tuiIsAttached for the probe.
  //
  // Presence is still read, for one reason: a turn that also renders in the
  // terminal looks, from the chat, like the bot ran something twice. The note
  // rides the progress line's first paint rather than being its own message, so
  // an ordinary turn is not made noisier by it.
  // Assigned inside the turn body, once the workspace is known. Absent
  // means "no session for this workspace yet" — the first turn after a switch.
  // The TUI presence note below reads it, so it runs after the resolve.
  let turnSessionId = null;

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
  // G-1 store facts. Declared out here because `result` and `displayResult` live
  // inside the try, and the record happens in the finally — where a turn that threw
  // must still be recorded. `turnStartedAt` doubles as the turn id, so a retry of
  // the same turn spools under the same name and stays idempotent.
  const turnStartedAt = Date.now();
  const storeFacts = { bot: config.id, chat: chatId, location: process.env.LOCATION || '', at: new Date(turnStartedAt).toISOString() };
  // The turn's seat is read inside the try, but the finished-turn record in the
  // `finally` reads it too. A `let` declared inside the try block is not in
  // scope there, so every turn that reached the record threw
  // "activeRole is not defined" and the thread was never recorded. Declared out
  // here, assigned in the try: both blocks see the same binding.
  let activeRole = null;
  try {
    await renderer.start();
    // One shared working headline (provider + model + elapsed + usage) for
    // every bot-host agent — same line shape as the Grok TG router. The
    // provider follows the chat's effective model, not the registry default.
    const roleHeadlineLabel = addr?.roleId
      ? `${addr.roleId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} (${providerLabelForModel(eff.model)})`
      : addr?.isBroadcast
        ? `Council Coordinator (${providerLabelForModel(eff.model)})`
        : providerLabelForModel(eff.model);
    // Headline for the lane actually running, mirroring the role prefix above —
    // so a displaced or failed-over turn never keeps announcing the dead lane
    // it started on. The construction above stays untouched (landed work).
    const headlineForLane = (lane) => {
      const base = addr?.roleId
        ? String(addr.roleId).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : addr?.isBroadcast
          ? 'Council Coordinator'
          : '';
      return base ? `${base} (${providerLabelForModel(lane)})` : providerLabelForModel(lane);
    };
    renderer.setHeadline({
      providerLabel: roleHeadlineLabel,
      modelLabel: chatLaneName(eff.model) || '',
    });
    // Paint the headline now (starting… 0s) so the chat sees the turn begin
    // at once; the old lazy path left only bare typing until the first
    // model event, which on a slow lane looks stuck.
    await renderer.announce().catch(() => {});
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

    let activeProject = getChatProject(chatId);
    activeRole = getChatRole(chatId);

    if (addr?.roleId) {
      activeRole = addr.roleId;
      if (['data_steward', 'health_analyst', 'test_planner', 'research_lead', 'safety_reviewer', 'doctor', 'lifestyle'].includes(addr.roleId)) {
        activeProject = KNOWN_PROJECTS['external-health'];
      }
    } else if (addr?.isBroadcast) {
      if (activeProject.id === 'health-tracker' || activeProject.id === 'external-health') {
        activeProject = KNOWN_PROJECTS['external-health'];
      }
      activeRole = null;
    }

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
    // The chat's saved /location wins over this process's env: env dies on
    // restart, the pref is reloaded on boot. A saved remote host that went
    // silent is held by the remote branch below — never run locally.
    const location = desiredLocation(prefs, chatId) || workLocation();
    const workId = sessionKey({ location, chat: String(chatId), workspace: effectiveWorkspace, project: activeProject.id });
    const workLane = ref.surface === 'cline' ? 'cline' : ref.surface === 'gemini' ? 'gemini' : 'opencode';
    // G-1: everything about this turn that is already decided, recorded now rather
    // than at the end. Turns return early in plenty of ways — a held remote route, an
    // abort, a preflight refusal — and those are exactly the turns worth having in the
    // log. The outcome is filled in later, where the result is in scope.
    Object.assign(storeFacts, {
      project: activeProject?.id || '',
      role: activeProject?.activeRole || '',
      model: eff.model || '',
      lane: workLane,
      location: location || storeFacts.location,
      prompt: String(quotedPrompt || text || '').slice(0, 2000),
      turnId: `${config.id}-${chatId}-${turnStartedAt}`,
      outcome: 'started',
    });
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
    // is re-ensured when the lane comes back to OpenCode. Only for an
    // already-live TUI view (plan/TG_TOOL_SURFACE.md M1): a stale `tx: true`
    // row must not boot a private `opencode serve` on an ordinary message.
    if (workSession.tx && workSession.viewMode === 'tui' && workSession.serverUrl && workSession.opencodeSessionId) {
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
    // The session this chat owns in the workspace THIS turn runs in. Null means
    // "start one here", which is the correct answer after a project switch and
    // also when the stored row belongs to another project. Computed here, after
    // the work session is resolved and its view settled — reading it earlier put
    // this assignment in the `workSession` temporal dead zone and every agent
    // turn died with "Cannot access 'workSession' before initialization".
    turnSessionId = sessionForWorkspace(sessions, chatId, effectiveWorkspace)
      || (workSession?.viewMode === 'tui' && workSession.opencodeSessionId
        ? workSession.opencodeSessionId
        : undefined);
    // Connectivity pings run throwaway: force a fresh session so their
    // scaffolding never lands in the chat's transcript or the TUI.
    if (isPingTurn) turnSessionId = null;


    // A TUI is open on this same conversation, so the user can watch this turn
    // happen in the terminal as well. It shares the session, so what runs here
    // shows up there — one turn at a time, never two at once.
    //
    // Only true on a lane with a shared session. Cline's terminal resumes the
    // LAST Cline thread and each new message starts a fresh one, so claiming
    // "same session" there would be a lie the user discovers by watching a turn
    // that never appears. Say the true thing instead.
    //
    // This runs AFTER the resolve above on purpose: it used to run before the
    // headline announce with turnSessionId still null, and a null wanted
    // matches any lease — so the chat was told "same session" for a TUI on a
    // different conversation. No session yet (first turn) means no claim.
    if (turnSessionId && tuiIsAttached(config.id, turnSessionId)) {
      const openSurface = tuiSurfaceFor(effective(config, prefs, chatId).model);
      await api.sendMessage(chatId, openSurface.sharedSession
        ? '⌨️ A TUI is open on this conversation — you can watch this turn in the terminal. Same session, so it shows up in both; one turn at a time.'
        : `⌨️ A ${openSurface.tool} terminal is open, but ${openSurface.tool} cannot resume a thread headlessly — this turn will not appear there. The terminal stays on the last ${openSurface.tool} thread.`
      ).catch(() => {});
    }

    // A TUI is open on this same conversation, so the user can watch this turn
    // happen in the terminal as well. It shares the session, so what runs here
    // shows up there — one turn at a time, never two at once.
    //
    // Only true on a lane with a shared session. Cline's terminal resumes the
    // LAST Cline thread and each new message starts a fresh one, so claiming
    // "same session" there would be a lie the user discovers by watching a turn
    // that never appears. Say the true thing instead.
    //
    // This runs AFTER the resolve above on purpose: it used to run before the
    // headline announce with turnSessionId still null, and a null wanted
    // matches any lease — so the chat was told "same session" for a TUI on a
    // different conversation. No session yet (first turn) means no claim.
    if (turnSessionId && tuiIsAttached(config.id, turnSessionId)) {
      const openSurface = tuiSurfaceFor(effective(config, prefs, chatId).model);
      await api.sendMessage(chatId, openSurface.sharedSession
        ? '⌨️ A TUI is open on this conversation — you can watch this turn in the terminal. Same session, so it shows up in both; one turn at a time.'
        : `⌨️ A ${openSurface.tool} terminal is open, but ${openSurface.tool} cannot resume a thread headlessly — this turn will not appear there. The terminal stays on the last ${openSurface.tool} thread.`
      ).catch(() => {});
    }

    // Only when a tx view is NOT live: with one, the session comes from the
    // work-session row instead. The id is workspace-scoped now, so a chat that
    // switched project passes nothing here rather than the previous project's
    // conversation — which the tool would happily resume, in the wrong tree.
    if (workSession.viewMode !== 'tui' && turnSessionId) extraArgs.push('--session', turnSessionId);
    try { observer = createObserver(workSession); } catch {}
    observerContext = { model: eff.model, attempt: 1, surface: ref.surface, provider: ref.surface };
    // Local fanout: headline + observer log always. The feed is
    // fire-and-forget — a send hiccup must never break the run.
    const onObserverEvent = (event) => {
      fanoutProgressEvent({ renderer, observer, event, context: observerContext });
    };
    let lastAttemptModel = eff.model;
    const runSurfaceModel = async (model) => {
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
      // Only a level this model offers travels as `#variant`. Anything else
      // runs bare: an unoffered suffix is a hard "Invalid model reference"
      // on strict models (see pickOfferedVariant). The verbose catalog is
      // warmed at boot, so this is a cache read on a warm poller.
      let opencodeVariant;
      if (eff.variant) {
        try {
          opencodeVariant = pickOfferedVariant(eff.variant, await getVariants(config, caches, model));
        } catch {
          opencodeVariant = undefined;
        }
      }
      return runOpencode({
        prompt: finalPrompt,
        model,
        variant: opencodeVariant,
        workspace: effectiveWorkspace,
        thinking: config.agent.thinking,
        timeoutMs: config.agent.timeoutMs,
        opencodeBin: config.agent.opencodeBin,
        // No server flag, on purpose. The turn runs against the opencode
        // background service, which is the same service the TUI terminal talks
        // to — that shared server is what lets both stay live on one session.
        //
        // This used to pass `attachUrl` here, and buildOpencodeArgs turned it
        // into `--attach <url>`. opencode v2.0.19 has no `--attach`: the flag
        // makes the CLI print its help and exit 1, so every turn with a `tx on`
        // view died with "the model returned no text output" and no artifact —
        // the same class of failure the neighbouring `--variant` comment
        // records. v2 spells it `--server`, but that needs OPENCODE_PASSWORD
        // against a service that requires one (verified: `opencode models
        // --server <background url>` refuses without it), and the bot holds no
        // such password. The default service path needs no credential at all,
        // which is why it is the right one here.
        // The session this chat is on IN THIS WORKSPACE, not the row's bare id.
        //
        // This used to be `workSession.viewMode === 'tui' ? … : undefined`, so a
        // turn with no /tx view passed NO session at all: the tool picked or
        // created one in the bot's workspace while the TUI showed the session from
        // sessions.json, which by then could be a different project's
        // conversation entirely. That is the whole reason the TUI and the bot
        // disagreed — this value, not the gateway.
        sessionId: turnSessionId,
        onEvent: onObserverEvent,
        onSpawn: (child) => running.set(chatId, { child, aborted: false, serverUrl: workSession.serverUrl, opencodeSessionId: workSession.opencodeSessionId }),
        onAbort: () => abortOpencodeSession({ serverUrl: workSession.serverUrl, sessionId: workSession.opencodeSessionId }).catch(() => false),
        extraArgs,
        env: { ...opencodeEnv(config), ...chatEnv(api, chatId) },
        envMode: turnEnvMode,
      });
    };

    // One remote turn, shared by the primary path below and the QS-9
    // auto-continue chain above it: holds and failed canaries finish here
    // (messaging unless quiet); a delivered answer finishes here; a dry worker
    // (empty text, quota signal) comes back unanswered so the chain can walk
    // on. Returns { done, dry, handed }.
    const runRemoteTurn = async (host, { wantCanary, quiet = false, hopFrom = '', sessionOverride = null, freshRetried = false } = {}) => {
      const say = async (text) => {
        if (!quiet) await api.sendMessage(chatId, text).catch(() => {});
      };
      const foot = `host: ${host}${wantCanary ? ' (canary)' : ''}${hopFrom ? ` (continued from ${hopFrom})` : ''}`;
      const remoteStatus = workerStatus(host);
      if (!remoteStatus.reachable) {
        setBlockedLocation(chatId, host, remoteStatus.reason);
        await say(
          `⏸ *Held:* \`${host}\` is unreachable (${remoteStatus.reason}).\nNothing ran and no allowance was sent. Send \`/location vps\` to run here, or wait for the ${host} worker to connect.`
        );
        return { done: true, held: true, reason: `unreachable: ${remoteStatus.reason}`, handed: null };
      }
      if (wantCanary && routeState(host) === 'failed') {
        const row = routeFor(host);
        const why = failedRouteReason(row);
        await say(
          `⏸ *Held:* the route to \`${host}\` was rolled back after a failed canary (${why}).\nNothing ran here either. Send \`/location ${host}\` to arm it again (the first turn is re-checked), or \`/location vps\` to run on this machine.`
        );
        return { done: true, held: true, reason: `route failed: ${why}`, handed: null };
      }
      // Remote live view: the worker streams its onEvent records to the relay
      // while the turn runs there. Fan each one through the same local
      // fanout (headline + observer log) — a remote turn looks exactly
      // like a local one in this chat.
      // Register the run first so the relay flag reaches it via the
      // aborted check; the entry is cleared in the finally block.
      // `wantCanary` is this function's parameter, not a route lookup: the
      // caller decides whether this hop is a canary.
      const onRemoteEvent = (event) => {
        if (running.get(chatId)?.aborted) return;
        fanoutProgressEvent({ renderer, observer, event, context: observerContext });
      };
      if (observer) observer.write('run_start', {}, observerContext);
      const handed = await runOnWorker({
        host,
        prompt: finalPrompt,
        model: eff.model,
        project: isExternalTurn ? activeProject.id : 'health-tracker',
        role: activeRole || '',
        workspace: effectiveWorkspace,
        sessionId: sessionOverride !== null ? sessionOverride : turnSessionId || '',
        envMode: turnEnvMode,
        canary: wantCanary,
        preflightFull: wantCanary,
        packRoot: wantCanary ? effectiveWorkspace : '',
        onJob: ({ jobId }) => running.set(chatId, { child: null, aborted: false, jobId, relay: '' }),
        onEvent: onRemoteEvent,
      });
      observerTerminalWritten = true;
      if (observer) {
        const wasAborted = Boolean(running.get(chatId)?.aborted);
        observer.write(wasAborted ? 'aborted' : handed?.text ? 'run_complete' : 'failed', handed || {}, observerContext);
      }
      if (handed?.preflight) {
        // Stale-session repair (decision 1b): a ghost thread id fails preflight
        // with session-404, which would hold every future remote turn forever.
        // Exactly once per turn, retry fresh with an explicit notice naming the
        // lost thread. Malformed ids and opencode outages still hold.
        if (!freshRetried && isStaleSessionPreflight(handed.preflight)) {
          const lost = sessionOverride !== null ? sessionOverride : turnSessionId || '';
          await say(
            `⚠️ Previous thread \`${lost || 'unknown'}\` is gone from \`${host}\` — running this turn fresh so the chat is not stuck.`
          );
          return runRemoteTurn(host, { wantCanary, quiet, hopFrom, sessionOverride: '', freshRetried: true });
        }
        setBlockedLocation(chatId, host, `${handed.preflight.failed}: ${handed.preflight.reason}`);
        await say(
          `⏸ *Held:* preflight failed for \`${host}\` — \`${handed.preflight.failed}\`: ${handed.preflight.reason}\n${preflightSummary(handed.preflight.checks)}\nNothing ran and no allowance was sent.`
        );
        return { done: true, held: true, reason: `preflight ${handed.preflight.failed}: ${handed.preflight.reason}`, handed };
      }
      if (wantCanary) {
        // Guard 6: one turn decides whether the route becomes active. The
        // session row is never touched until it passes, so a bad canary costs
        // nothing but the canary. settleCanary is the same function the swap
        // drill runs, so what is proven there is what happens here.
        const settled = settleCanary({ host, result: handed, sessionId: turnSessionId || '', jobId: handed.jobId || '' });
        if (!settled.ok) {
          const back = settled.route?.previous || 'vps';
          await say(
            `⚠️ *Canary failed on \`${host}\`:* ${settled.reason}\nRoute rolled back to \`${back}\`; the conversation row was left untouched.${handed.text ? `\n\n${handed.text}` : ''}`
          );
          return { done: true, held: true, reason: `canary failed: ${settled.reason}`, handed };
        }
        console.log(`[${config.id}] canary passed on ${host} (job ${handed.jobId}); route active`);
      }
      // The thread id the worker ran is now ours too, so the next turn —
      // here or there — resumes the same conversation.
      if (handed.sessionID) {
        bindSessionForWorkspace(sessions, chatId, effectiveWorkspace, handed.sessionID);
        // The view is built from this record, so the record has to name the
        // thread that just ran — otherwise /tx keeps showing the conversation
        // from the previous host until something else rewrites it.
        workSession = setWorkView(workSession.id, { opencodeSessionId: handed.sessionID }) || workSession;
        if (workSession.tx && workSession.viewMode === 'tui' && workSession.serverUrl && workSession.opencodeSessionId) {
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
      // QS-9: a worker that answers empty-handed with a quota signal is dry,
      // not done — the chain walks on instead of delivering an empty answer.
      if (!String(handed.text || '').trim() && isQuotaOrLimitError(String(handed.error || ''))) {
        console.log(`[${config.id}] turn on ${host} came back dry (quota); trying the next host`);
        return { done: false, dry: true, handed };
      }
      // QS-4: a depletion-driven hop says which pack path wrote it. The summary
      // writer is picked from this machine's lanes excluding the lane that
      // just died, so the failed lane is never asked to summarize itself.
      if (hopFrom && handed.packManifest) {
        try {
          const pack = await resolvePackPath({
            manifest: handed.packManifest,
            failedLane: handed.model || '',
            lanesFn: async () => (selectTurnLanes({ botId: config.id, model: eff.model, fallback: config.agent.model, pool: eff.pool, readiness: hostReadiness(caches, config.id), catalogEntries: await getFreeModels(caches, config) }).models || []),
            summarizeFn: async ({ model: lane, manifest: man }) => (await runOpencode({
              prompt: `Summarize this handoff pack in 10 lines or less (files changed, what the next turn needs):\n${(man.files || []).map((f) => `- ${f.path} (${f.bytes} bytes)`).join('\n')}`,
              model: lane,
              workspace: effectiveWorkspace,
              timeoutMs: 120000,
            }))?.finalText || '',
          });
          await api.sendMessage(chatId, packPathLine(pack)).catch(() => {});
        } catch {
          // the pack line is informational; the answer finishes below regardless
        }
      }
      console.log(`[${config.id}] turn ran on ${host} (job ${handed.jobId}, ledger ${handed.ledger || 'worker'}${handed.sessionID ? `, session ${handed.sessionID}` : ''})`);
      // Same rule as the local path below: a result that lands after the turn
      // was aborted belongs to a dead turn. Delivering it would answer a
      // question the user already cancelled — on 2026-09-27 a 2000-word essay
      // arrived 26s after the abort ack because this call had no aborted check.
      if (running.get(chatId)?.aborted) {
        renderer.status = 'aborted';
        renderer.settle('Aborted');
        await renderer.deliver('Aborted.').catch(() => {});
      } else {
        await renderer.finish(
          { finalText: handed.text || '', lastError: handed.error || '', code: handed.code },
          { footer: foot }
        ).catch(() => {});
      }
      return { done: true, delivered: true, handed };
    };
    // The ledger picks the walk. A lane it already stamped is not retried, an
    // ended lane is never offered, and a terminal-only row is never chosen.
    // Readiness is passed so a vendor with no credential on this host reads as
    // needs-setup (not selectable) instead of burning a turn on `Model
    // unavailable` every message (live VM5 2026-10-03: tokenharbor/cloudflare
    // have no key on the VPS).
    const laneChoice = selectTurnLanes({
      botId: config.id,
      model: eff.model,
      fallback: config.agent.model,
      pool: eff.pool,
      readiness: hostReadiness(caches, config.id),
      catalogEntries: await getFreeModels(caches, config),
    });
    if (laneChoice.exhausted) {
      // QS-9: the local ledger is empty, but that verdict only covers this
      // machine — a remote host may still serve the turn. Proven-dry hosts
      // stay out; the requested remote host is tried first (its allowance is
      // unknown, not empty).
      const remote = !isLocalHost(location);
      const cont = await continueTurnOnNextWorker({
        fromHost: location,
        tried: remote ? [] : [location],
        prefer: remote ? location : '',
        runTurn: (host) => runRemoteTurn(host, {
          wantCanary: routeState(host) !== 'active',
          quiet: true,
          hopFrom: location,
        }),
      });
      if (cont.ok) return;
      const when = laneChoice.soonest?.label ? ` Soonest reset: ${laneChoice.soonest.label}.` : '';
      const tried = cont.hops.length ? ` Tried ${cont.hops.map((h) => `\`${h.host}\` (${h.ok ? 'answered' : h.reason || 'dry'})`).join(', ')} — no location has quota.` : '';
      // A constrained chat is refused, not moved: the pool is the reader's own
      // instruction, so the refusal names that pool's reset and the way out of it
      // rather than quietly answering on the other one (decision D3).
      const poolBit = laneChoice.pool
        ? ` ${poolDisplayName(laneChoice.pool, location)} is the pool this chat asked to stay in, so no other pool was tried — \`/model\` clears it.`
        : '';
      await api.sendMessage(
        chatId,
        `🛑 No lane on ${location} has allowance right now.${when}${tried}${poolBit}\nNothing further was run and nothing was spent. Send \`/allowance\` for the ledger.`
      ).catch(() => {});
      return;
    }
    // Pings answer on their own single lane (see pingOnlyModels): the
    // pre-computed stays-on-X claim below would be false — sticky follows
    // the answer, and the ping reply itself already names where it ran
    // (live vm3 2026-10-06: notice said "stays on qwen" while the ping
    // answered live on direct gemini and sticky followed it there).
    if (laneChoice.displaced && !isPingTurn) {
      // Chat copy carries the compact countdown, never the ledger's absolute
      // stamp: "depleted until 2026-10-03T04:30:29Z (default TTL, no countdown
      // in vendor text) / Sat 11:30 WIB" is a log line, not a chat line (live
      // 2026-10-03). Lane names go through chatLaneName for the same reason —
      // no surface prefixes, no :free markers.
      const reason = String(laneChoice.displaced.why || '');
      const why = laneChoice.displaced.until
        ? `depleted (reset in ${formatResetIn(laneChoice.displaced.until, Date.now())})`
        : reason.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 160) || 'not available';
      console.log(`[${config.id}] lane ${eff.model} not selectable (${why}); using ${laneChoice.chose}`);
      // QS-2: "the same prompt completes on the next lane with a user-visible
      // switch line naming failed lane -> next lane". The walk did exactly that
      // on 2026-09-26 06:51Z — displaced the depleted cline lane, answered on the
      // OpenCode lane — and told the chat nothing, only the log. The lane a person
      // chose and the lane that actually ran were silently different, which is the
      // same class of silence as the raw-JSON specimen this row exists to kill.
      //
      // `why` is the ledger's own reason ("depleted until <stamp>"), never a raw
      // provider envelope, so this line cannot become the failure QS-2 forbids.
      // The headline was painted with the chat's (dead) model before the ledger
      // was read — repoint it at the lane actually running, and say the chat
      // stays there: without the stick the next turn announces the dead lane
      // as its starting model again, every message until reset.
      try {
        renderer.setHeadline({ providerLabel: headlineForLane(laneChoice.chose), modelLabel: chatLaneName(laneChoice.chose) });
      } catch {
        // a UI hiccup must never break failover
      }
      if (!laneChoice.degradedToLight) {
        await api.sendMessage(
          chatId,
          `🔀 \`${chatLaneName(eff.model)}\` is ${why} — this turn ran on \`${chatLaneName(laneChoice.chose)}\` instead, and the chat stays on \`${chatLaneName(laneChoice.chose)}\` until you switch back.`,
        ).catch(() => {});
      }
      // A coding turn that can only be served by a light model is said out loud.
      // Silently answering with a weaker model is how a coding task starts failing
      // in ways nobody notices until the code is wrong.
      if (laneChoice.degradedToLight) {
        console.log(`[${config.id}] no coding lane left; degraded to a light model (${laneChoice.chose})`);
        await api.sendMessage(
          chatId,
          `⚠️ \`${chatLaneName(eff.model)}\` is ${why}, and no coding lane is free right now — this turn runs on the light model \`${chatLaneName(laneChoice.chose)}\`. Code may be weaker than usual.`
        ).catch(() => {});
      }
    }
    // A location that names another machine runs there, on that machine's
    // allowance. This VM does not stamp for it. runRemoteTurn (above) performs
    // one remote turn for the primary path and the QS-9 chain.
    if (!isLocalHost(location)) {
      const hop0 = await runRemoteTurn(location, { wantCanary: routeState(location) !== 'active' });
      if (hop0.done) return;
      // QS-9: the chat's host is dry — same turn, next connected host with
      // quota. No manual /location, no dropped turn, every hop named.
      const cont = await continueTurnOnNextWorker({
        fromHost: location,
        tried: [location],
        runTurn: (host) => runRemoteTurn(host, {
          wantCanary: routeState(host) !== 'active',
          quiet: true,
          hopFrom: location,
        }),
      });
      if (cont.ok) return;
      const tried = cont.hops.length
        ? ` Tried ${cont.hops.map((h) => `\`${h.host}\` (${h.ok ? 'answered' : h.reason || 'dry'})`).join(', ')} — `
        : ' ';
      await api.sendMessage(
        chatId,
        `🛑 No lane on \`${location}\` has allowance right now,${tried}no location has quota. Nothing further was run and nothing was spent. Send \`/allowance\` for the ledger.`
      ).catch(() => {});
      return;
    }

    // A bot turn (`opencode run`, stdin ignored) that hits a permission would
    // hang to the turn timeout with no word in the chat. Watch its session and
    // ask here instead: Allow once / Always / Reject, timeout rejects. The
    // dev-TUI external-directory dialog is a different process and is not
    // bridged — approve that one in the TUI.
    const permWatch = startPermissionWatch({
      api,
      chatId,
      running,
      getSessionId: () => turnSessionId,
      workspace: effectiveWorkspace,
      env: { ...opencodeEnv(config), ...chatEnv(api, chatId) },
      envMode: turnEnvMode,
      opencodeBin: config.agent.opencodeBin,
    });
    // The lanes this turn may walk (the ledger's own projection), and their
    // context windows from the catalog — so the headline can show a share of
    // the window on the lane that is actually answering, not only on the few
    // lanes the static map happens to know. Best-effort, and it runs before the
    // walk: the cache it reads is the one the footer reads anyway.
    // Pings check the chat's own lane only; real prompts walk the ledger.
    const pingModels = pingOnlyModels({ isPingTurn, model: execModelRef(eff.model), fallback: execModelRef(config.agent.model) });
    const turnLaneModels = pingModels || (laneChoice.models.length ? laneChoice.models : failoverModels(eff.model, config.agent.model));
    const laneLimits = await laneContextLimits(config, caches, turnLaneModels);
    const result = await runOpencodeWithFailover({
      api,
      config,
      chatId,
      prompt: finalPrompt,
      models: turnLaneModels,
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
        // A mid-turn failover (ledger missed it, the lane died at runtime)
        // must move the headline too, or the progress line keeps naming the
        // dead lane while another one does the work — and the same for the
        // window the usage share is measured against: the lane's own, or the
        // static fallback when the catalog has no row for it.
        try {
          renderer.setHeadline({ providerLabel: headlineForLane(model), modelLabel: chatLaneName(model) });
          renderer.setCtxLimit(laneLimits.get(model));
        } catch {
          // a UI hiccup must never break failover
        }
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
    await stopPermissionWatch(permWatch);
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

    // Which surface produced the id decides which map it belongs in. A Cline
    // id in `sessions.json` would be handed to `opencode run --session` on the
    // next turn and the turn would die; an opencode id in the Cline map would
    // be handed to `cline --id`, which is refused outright. Before this, a Cline
    // turn stored nothing at all (runCline always resolved null), so the TUI
    // kept attaching to whatever stale opencode id was left in the map.
    const resultSurface = parseModelRef(lastAttemptModel).surface;
    // Ping turns never bind back: the throwaway session belongs to the
    // check, not the chat. Everything else (usage, ledger, sticky lane)
    // behaves exactly like a normal turn.
    if (result.sessionID && !isPingTurn) {
      if (resultSurface === 'cline') {
        const clineSessions = loadClineSessions(config.id);
        clineSessions.set(chatId, result.sessionID);
        saveClineSessions(config.id, clineSessions);
      } else {
        // Scoped to the workspace the turn actually ran in, so the next turn —
        // and the TUI — resume this conversation rather than a stale one.
        bindSessionForWorkspace(sessions, chatId, effectiveWorkspace, result.sessionID);
        saveSessions(config.id, sessions);
      }
    }
    // Auto-track (screenshot footer): a quota/rate-limit failure stamps Reset
    // into this bot's OWN free-lane ledger so /allowance goes ❌ with a time.
    trackRunQuota({ botId: config.id, modelRef: eff.model, result });
    // Non-OpenCode lanes used to dump raw provider envelopes (Cline's
    // INFERENCE_CAP_ERROR JSON + stderr tail) into the chat. Summarize them
    // into one actionable line; usage/ledger tracking above keeps the raw result.
    let displayResult = result;
    const finalSurface = resultSurface;
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
    // The result is in scope here, so the early capture is refined rather than
    // replaced — a turn that reached this point keeps its project/lane/prompt and
    // gains an outcome, an answer and a duration.
    Object.assign(storeFacts, {
      model: lastAttemptModel || eff.model || storeFacts.model,
      outcome: running.get(chatId)?.aborted ? 'aborted'
        : String(result?.finalText || '').trim() ? 'answered'
          : String(result?.lastError || '').trim() ? 'error' : 'empty',
      ms: Date.now() - turnStartedAt,
      answer: String(result?.finalText || '').slice(0, 4000),
      note: String(displayResult?.lastError || result?.lastError || '').slice(0, 200),
    });
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
      renderer.settle('Aborted');
      await renderer.deliver('Aborted.');
    } else {
      // Sticky failover: the chat asked for eff.model but the answer came from
      // another lane (ledger displacement above, or a mid-turn failover the
      // ledger only learned about via this turn's stamp). Point the chat at the
      // lane that actually answered so the next turn starts there instead of
      // announcing — and displacing — the dead lane again, every message until
      // reset. The previous choice is kept as autoSwitchedFrom for a one-tap
      // switchback after renewal. Bookkeeping must never break delivery.
      const stickTo = stickyModelAfterTurn({
        chatModel: eff.model,
        answeredModel: lastAttemptModel,
        answered: Boolean(String(result?.finalText || '').trim()),
      });
      const usageText = await noteUsage({ chatId, result, eff: stickTo ? { ...eff, model: stickTo } : eff, config, caches, totals, lastUsage });
      if (stickTo) {
        try {
          setPref(prefs, chatId, { model: stickTo, autoSwitchedFrom: eff.model, autoSwitchedAt: new Date().toISOString() });
          savePrefs(config.id, prefs);
          console.log(`[${config.id}] chat ${chatId} stuck to ${stickTo} (was ${eff.model})`);
        } catch {
          // fall through to delivery
        }
      }
      if (handoff) {
        const kept = prefFor(prefs, chatId);
        delete kept.handoff;
        setPref(prefs, chatId, kept);
        savePrefs(config.id, prefs);
      }
      // QS-11: a turn that died mid-answer arrives with its pieces attached.
      // The partial answer is delivered first, then the flag, then whatever
      // the next lane completed — never a silent truncation.
      if (result?._partialText) {
        displayResult = {
          ...displayResult,
          finalText: midstreamFlagText({
            partialText: result._partialText,
            deadLanes: result._midstreamQuota || [],
            continuedOn: result._continuedOn || '',
          }) + (String(displayResult?.finalText || '').trim() ? `\n\n${displayResult.finalText}` : ''),
        };
      }
      await renderer.finish(displayResult, { footer: usageText });

      // B2B-2: publish the finished text to whoever is hosting this turn. For a
      // human message there is no host and `delegation` is null, so this is a
      // single null check on the ordinary path. For a delegated turn the host
      // reads this string and puts it in an envelope — the model never sees the
      // wire, which is the property the whole design rests on.
      if (delegation) {
        delegation.text = String(displayResult?.finalText || '').trim();
        delegation.usage = displayResult?.usage || null;
        delegation.finishedAt = Date.now();
      }

      // Failproof-sync (turn-end hook): the pane shows whatever the last
      // attach resolved; the chat follows whatever just bound. On a
      // shared-session lane a mismatch means the open terminal is showing
      // another conversation — take it down verified-dead so the next tap
      // rebuilds on this one (live 2026-10-04: VM-tui-vm3 sat blank on ""
      // while the turn bound ses_ef7b…). Cline excluded: a fresh thread per
      // message makes mismatch normal there. Ping turns excluded: a
      // connectivity check must not move anything. Best-effort, never
      // breaking delivery; fires only on genuine mismatch, so matching
      // turns cost two file reads.
      if (!isPingTurn && resultSurface === 'opencode' && result?.sessionID) {
        try {
          const turnMark = `opencode:${result.sessionID}`;
          const paneMark = readTuiMark(config.id);
          const paneName = readTuiPane(config.id);
          if (paneMark && paneMark !== turnMark && paneName && hasTuiPane(paneName)) {
            killTuiPane(paneName);
            if (!hasTuiPane(paneName)) {
              try {
                fs.rmSync(tuiLeasePath(config.id), { force: true });
              } catch {
                /* the pane is gone either way */
              }
              try {
                fs.rmSync(tuiPanePath(config.id), { force: true });
              } catch {
                /* the pane is gone either way */
              }
              await api.sendMessage(chatId, `🔄 The open terminal was on another session, so I closed \`${paneName}\`. Tap \`/tui\` again — the new pane follows this conversation.`).catch(() => {});
            }
          }
        } catch {
          /* sync must never break delivery */
        }
      }
    }
  } catch (err) {
    if (observer && !observerTerminalWritten) {
      observerTerminalWritten = true;
      observer.write('failed', {}, observerContext || {});
    }
    await api.sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
    if (delegation) {
      // Deliberately left EMPTY, not the error text: the host must not forward a
      // failure notice to a peer as though it were the work. An empty capture is
      // how it learns the turn did not finish.
      delegation.text = '';
      delegation.error = String(err?.message || err).slice(0, 200);
    }
  } finally {
    renderer.stopTyping();
    running.delete(chatId);
    busy.delete(chatId);
    releaseFiles(claimed, claimId);
    recordRunFinish(config.id, chatId);
    if (storeFacts.outcome === 'answered') {
      recordActiveThread(chatId, {
        roleId: activeRole || addr?.roleId || null,
        botId: config.me?.id || config.id,
        isCouncil: Boolean(addr?.isBroadcast),
        jointRoles: addr?.jointRoles || [],
        timestamp: Date.now(),
      });
    }
    // G-1: a real finished turn is what the store exists to record. This is the
    // only place it is written, it runs on every outcome (answered, empty, failed,
    // aborted), and it cannot throw or await: a Google outage must not cost the
    // chat its answer, and a turn must not wait on an API that can take minutes
    // while Google's front door serves it a challenge page.
    try {
      // A turn that returned early still gets an honest outcome rather than the
      // 'started' placeholder it was born with.
      if (storeFacts.outcome === 'started') {
        storeFacts.outcome = running.get(chatId)?.aborted ? 'aborted' : 'held';
        storeFacts.ms = Date.now() - turnStartedAt;
      }
      recordTurn(storeFacts);
    } catch (err) {
      // A store that cannot record must be visible, not silent: /store shows the
      // spool depth, and the turn above already reached the chat.
      console.error(`[store] turn not recorded: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
    }
    // Drain one queued follow-up as its own turn (depth-guarded; the queue
    // itself is capped at MAX_FOLLOWUPS). busy is free again, so the recursive
    // call runs the full turn path — headline, feed, failover, finish — and
    // records its own turn in the store above.
    if (depth < MAX_FOLLOWUPS) {
      const next = shiftFollowup(chatId);
      if (next) {
        await api.sendMessage(chatId, `▶️ Running queued follow-up (${queuedFollowups(chatId).length} left in queue)…`).catch(() => {});
        await handleMessage({
          api, config, throttle, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, busy,
          message: { ...message, text: next, caption: undefined },
          depth: depth + 1,
        });
      }
    }
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
  // M1 boot warmup (see warmTurnCaches): the first turn after a restart must
  // not pay the ~3s cold catalog build inside the send→session-row budget.
  await warmTurnCaches(config, caches);
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
      // Shorter holds survive hostile networks (phone radio, NAT timeouts):
      // TG_POLL_TIMEOUT=10 on mobile. Default 30 everywhere else.
      updates = await api.getUpdates({ offset, timeout: Number(process.env.TG_POLL_TIMEOUT) || 30, allowedUpdates: ['message', 'callback_query'] });
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
          handleCallback({ api, config, prefs, caches, running, query: update.callback_query }).catch((err) => {
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
    // Simulate is the local operator at the terminal: no Telegram sender, so
    // act as the first allowlisted user (the operator seat) explicitly.
    userId: Number(config.telegram?.allowedUserIds?.[0] || 0),
    kind: 'direct',
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
  ACTIVE_REGISTRY_PATH = registryPath;
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
  // Private-chat roles are per bot. Bind before any command or turn reads them.
  bindRegistryBot(config.id);
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
  // G-1: drain the Google spool in the background. Started once per bot, beside the
  // lease renewer, so a store outage never has a path into a chat turn.
  startStoreFlusher(config);

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
// Group addressing needs to know who this process is. Without it, five bots in
// one group would all answer everything.
config.me = { id: Number(me.id) || 0, username: String(me.username || '') };
  // Write down who we are, so another seat can address us by name without
  // holding our token or asking Telegram on its message path. Read back by
  // `resolvePeerUsername` / `findSeatByUsername` in lib/tg-peers.mjs.
  try {
    writeJson(path.join(stateDir(config.id), 'identity.json'), {
      id: config.id,
      username: config.me.username,
      telegramId: config.me.id,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[${config.id}] identity.json write failed (peer addressing unavailable): ${err.message}`);
  }
  try {
    assertValidCommands(BOT_COMMANDS);
    await api.call('setMyCommands', { commands: toTelegramCommands() });
    console.log(`[${config.id}] published ${toTelegramCommands().length} bot commands`);
  } catch (err) {
    console.error(`[${config.id}] setMyCommands failed (non-fatal): ${err.message}`);
  }
  // Narrow Telegram scopes override the default menu in matching chats, so a
  // stale per-scope list silently hides commands (vm lost /forge in every
  // private chat to a leftover `all_private_chats` list holding abort/watch).
  // No code publishes per-scope menus — the default scope is the single
  // source — so every boot deletes the narrow overrides, keeping one menu
  // everywhere without a manual Bot API call. Non-fatal, like the publish.
  for (const scope of ['all_private_chats', 'all_group_chats', 'all_chat_administrators']) {
    try {
      await api.call('deleteMyCommands', { scope: { type: scope } });
    } catch (err) {
      console.error(`[${config.id}] deleteMyCommands(${scope}) failed (non-fatal): ${err.message}`);
    }
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

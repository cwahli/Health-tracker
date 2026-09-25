/**
 * Shared work sessions for BOT-19.
 *
 * A work session is created on demand per active (location, chat, workspace)
 * — never permanently per bot. `tx on` enables the shared work view; `tx
 * off` hides it without stopping work. Generic debug/handoff/abort work for
 * every bot and backend.
 *
 * Physical mapping: one location maps to one tmux session; each workstream
 * maps to a window inside it. Lane changes keep the work session with a
 * handoff record; abort preserves the transcript reference. Anything shown
 * toward Telegram passes through the scrubbed view — no raw secrets.
 *
 * Store is host-local (default ~/.hermes/work-sessions.json, override with
 * WORK_SESSIONS) — one JSON object, best-effort. Disable with WORK_SESSIONS=0.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { laneFor } from './lane-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OBSERVER_MAX_BYTES = 1024 * 1024;

function observerRootPath() {
  return process.env.WORK_OBSERVERS || path.join(os.homedir(), '.hermes', 'work-observers');
}

export function observerLogPath(session, root = observerRootPath()) {
  const identity = session?.id || sessionKey(session || {});
  const digest = createHash('sha256').update(String(identity)).digest('hex');
  return path.join(root, `session-${digest}.log`);
}

function safeObserverString(value, max = 120) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeObserverNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const OBSERVER_SECRET_KEY = /(?:^|[_-])(?:api[_-]?key|access[_-]?key|token|secret|password|passwd|authorization|cookie|credential|private[_-]?key)$/i;

function redactObserverValue(value, key = '') {
  if (key && OBSERVER_SECRET_KEY.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactObserverValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactObserverValue(childValue, childKey)]));
  }
  if (typeof value === 'string') return scrubSecrets(value);
  return value;
}

function safeObserverContent(value, max = 16000) {
  let serialized;
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(redactObserverValue(value));
  } catch {
    serialized = String(value ?? '');
  }
  return scrubSecrets(safeObserverString(serialized, max));
}

function observerContext(context = {}) {
  const record = {};
  if (context.model != null) record.model = safeObserverString(context.model, 160);
  if (context.attempt != null) record.attempt = safeObserverNumber(context.attempt);
  if (context.surface != null) record.surface = safeObserverString(context.surface, 40);
  if (context.provider != null) record.provider = safeObserverString(context.provider, 80);
  return record;
}

export function formatObserverRecord(type, payload = {}, context = {}, at = new Date().toISOString()) {
  const record = { at: String(at), type: String(type) };
  Object.assign(record, observerContext(context));
  if (type === 'event') {
    const kind = String(payload?.kind || '');
    if (kind === 'reasoning') return { ...record, kind: 'thinking', content: safeObserverContent(payload.text) };
    if (kind === 'text') return { ...record, kind: 'text', content: safeObserverContent(payload.text) };
    if (kind === 'tool') {
      return {
        ...record,
        kind: 'tool',
        tool: safeObserverString(payload.tool, 100),
        status: safeObserverString(payload.status, 60),
        content: safeObserverContent({ input: payload.input, output: payload.output }),
      };
    }
    if (kind === 'run_result') return { ...record, kind: 'text', content: safeObserverContent(payload.text) };
    if (kind === 'error') return { ...record, kind: 'error', content: safeObserverContent(payload.message) };
    if (kind === 'step_finish') {
      const tokens = payload?.tokens;
      const total = typeof tokens === 'object' ? tokens?.total : tokens;
      return {
        ...record,
        kind: 'usage',
        tokens: safeObserverNumber(total),
        cost: safeObserverNumber(payload?.cost),
      };
    }
    return null;
  }
  if (type === 'run_start' || type === 'run_complete' || type === 'aborted' || type === 'failed') {
    if (type === 'run_complete' || type === 'failed') {
      const tokens = payload?.usage?.tokens;
      const total = typeof tokens === 'object' ? tokens?.total : tokens;
      record.tokens = safeObserverNumber(total);
      record.cost = safeObserverNumber(payload?.usage?.cost);
      if (type === 'run_complete') record.content = safeObserverContent(payload?.finalText);
      if (type === 'failed') record.content = safeObserverContent(payload?.lastError);
    }
  }
  return record;
}

function ensureObserverFile(logPath) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(logPath), 0o700);
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', { mode: 0o600 });
    fs.chmodSync(logPath, 0o600);
  } catch {
    return false;
  }
  return true;
}

export function writeObserverRecord(logPath, record, maxBytes = OBSERVER_MAX_BYTES) {
  const line = `${JSON.stringify(record)}\n`;
  const bytes = Buffer.byteLength(line);
  try {
    ensureObserverFile(logPath);
    if (fs.statSync(logPath).size + bytes > maxBytes) {
      const previous = `${logPath}.1`;
      try { fs.rmSync(previous, { force: true }); } catch {}
      try { fs.renameSync(logPath, previous); } catch {}
    }
    fs.appendFileSync(logPath, line, { mode: 0o600 });
    fs.chmodSync(logPath, 0o600);
    return true;
  } catch {
    return false;
  }
}

export function createObserver(session, { root = observerRootPath(), maxBytes = OBSERVER_MAX_BYTES, now = () => new Date().toISOString() } = {}) {
  const logPath = observerLogPath(session, root);
  ensureObserverFile(logPath);
  const write = (type, payload = {}, context = {}) => {
    const record = formatObserverRecord(type, payload, context, now());
    return record ? writeObserverRecord(logPath, record, maxBytes) : false;
  };
  return {
    path: logPath,
    write,
    onEvent(event, context = {}) {
      return write('event', event, context);
    },
  };
}

export function sessionsPath() {
  if (process.env.WORK_SESSIONS === '0') return null;
  return process.env.WORK_SESSIONS || path.join(os.homedir(), '.hermes', 'work-sessions.json');
}

/** Session key: location + chat + workspace. Never the bot id. */
export function sessionKey({ location = '', chat = '', workspace = '' } = {}) {
  return [String(location), String(chat), String(workspace)].join('|');
}

/** tmux session per physical location; workstream maps to a window. */
export function tmuxSessionFor(location) {
  const slug = String(location ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `work-${slug || 'local'}`;
}

export function tmuxWindowFor(sessionId) {
  const raw = String(sessionId ?? '');
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'run';
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `ws-${slug}-${digest}`;
}

function loadStore(storePath = sessionsPath()) {
  try {
    if (!storePath || !fs.existsSync(storePath)) return { sessions: {} };
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) return { sessions: {} };
    return parsed;
  } catch {
    return { sessions: {} };
  }
}

function saveStore(store, storePath = sessionsPath()) {
  if (!storePath) return false;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the session for (location, chat, workspace), creating it on
 * demand. Returns the session record.
 */
export function resolveSession({ location = '', chat = '', workspace = '', lane = 'opencode' } = {}, storePath = sessionsPath()) {
  const store = loadStore(storePath);
  const key = sessionKey({ location, chat, workspace });
  if (!store.sessions[key]) {
    const now = new Date().toISOString();
    store.sessions[key] = {
      id: key,
      location: String(location),
      chat: String(chat),
      workspace: String(workspace),
      lane: String(lane),
      laneHistory: [String(lane)],
      tx: false,
      viewMode: 'observer',
      viewCommand: null,
      state: 'active',
      transcriptRef: null,
      createdAt: now,
      updatedAt: now,
    };
    saveStore(store, storePath);
  }
  return store.sessions[key];
}

/** Read a session by id. Null when unknown. */
export function getSession(id, storePath = sessionsPath()) {
  return loadStore(storePath).sessions[String(id)] || null;
}

function updateSession(id, patch, storePath = sessionsPath()) {
  const store = loadStore(storePath);
  const cur = store.sessions[String(id)];
  if (!cur) return null;
  store.sessions[String(id)] = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  saveStore(store, storePath);
  return store.sessions[String(id)];
}

/** tx on/off: shared observation without stopping work. */
export function setTx(id, on, storePath = sessionsPath()) {
  return updateSession(id, { tx: Boolean(on) }, storePath);
}

export function setWorkView(id, patch, storePath = sessionsPath()) {
  return updateSession(id, patch, storePath);
}

/**
 * Lane change keeps the work session: records the handoff, preserves all
 * other state. Returns the updated session, null when unknown.
 */
export function handoffSession(id, toLane, storePath = sessionsPath()) {
  laneFor(toLane); // throws on unknown backend
  const cur = getSession(id, storePath);
  if (!cur) return null;
  return updateSession(id, {
    lane: String(toLane),
    laneHistory: [...(cur.laneHistory || []), String(toLane)],
  }, storePath);
}

/**
 * Abort preserves state: marks closed, keeps the transcript reference.
 * Never deletes the session record.
 */
export function abortSession(id, { transcriptRef = null } = {}, storePath = sessionsPath()) {
  const cur = getSession(id, storePath);
  if (!cur) return null;
  return updateSession(id, { state: 'aborted', transcriptRef }, storePath);
}

export function checkpointSession(id, { handoffRef = null } = {}, storePath = sessionsPath()) {
  if (!getSession(id, storePath)) return null;
  return updateSession(id, { state: 'handoff', handoffRef }, storePath);
}

/** Default tmux runner. Injected (fake) in tests. */
export function defaultTmuxRunner(args) {
  try {
    return execFileSync('tmux', args, { stdio: 'pipe', encoding: 'utf8' }).trim() || true;
  } catch {
    return false;
  }
}

function tmuxWindowExists(tmuxSession, tmuxWindow, tmux) {
  const output = tmux(['list-windows', '-t', tmuxSession, '-F', '#{window_name}']);
  if (typeof output !== 'string') return Boolean(output);
  return output.split(/\r?\n/).includes(tmuxWindow);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function observerCommand(logPath) {
  return `/usr/bin/tail -n 40 -F -- ${shellQuote(logPath)}`;
}

function workViewCommand(session, logPath = observerLogPath(session)) {
  return session?.viewCommand || observerCommand(logPath);
}

/**
 * Real tmux renders `pane_start_command` as a shell-style quoted word
 * ("cmd 'arg'") while fake runners in tests pass it through unquoted. An
 * exact-equality observer matcher must see both shapes as the same command
 * or it never recognizes the pane it created (live defect found 2026-09-24:
 * probe reported observerLive:false on a live tail pane, /tx on would spawn
 * duplicate panes forever, /tx off could never kill one).
 */
export function unquoteTmuxValue(value) {
  const raw = String(value ?? '');
  for (const quote of ['"', "'"]) {
    if (raw.length >= 2 && raw.startsWith(quote) && raw.endsWith(quote)) {
      return raw.slice(1, -1).replaceAll(`\\${quote}`, quote);
    }
  }
  return raw;
}

function parseObserverPanes(output) {
  if (typeof output !== 'string') return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const command = tab >= 0 ? line.slice(tab + 1) : '';
    return { id: tab >= 0 ? line.slice(0, tab) : line, command: unquoteTmuxValue(command) };
  });
}

function observerPaneFor(target, logPath, tmux, expected = observerCommand(logPath)) {
  const panes = parseObserverPanes(tmux(['list-panes', '-t', target, '-F', '#{pane_id}\t#{pane_start_command}']));
  const normalized = unquoteTmuxValue(expected);
  return panes.find((pane) => pane.command === expected || pane.command === normalized) || null;
}

export function disableTmuxObserver(session, { tmux = defaultTmuxRunner } = {}) {
  if (!session) return { ok: false, stopped: false, pane: null };
  const lane = laneFor(session.lane);
  if (lane.kind !== 'cli' || !session) return { ok: false, stopped: false, pane: null };
  const tmuxSession = tmuxSessionFor(session.location);
  const tmuxWindow = tmuxWindowFor(session.id);
  const target = `${tmuxSession}:${tmuxWindow}`;
  const logPath = observerLogPath(session);
  const pane = observerPaneFor(target, logPath, tmux, workViewCommand(session, logPath));
  if (!pane) return { ok: true, stopped: false, pane: null };
  const stopped = Boolean(tmux(['kill-pane', '-t', pane.id]));
  return { ok: stopped, stopped, pane: pane.id };
}

function keepOnlyTmuxPane(target, keepPaneId, tmux) {
  const panes = parseObserverPanes(tmux(['list-panes', '-t', target, '-F', '#{pane_id}\t#{pane_start_command}']));
  const removed = [];
  for (const pane of panes) {
    if (pane.id === keepPaneId) continue;
    if (tmux(['kill-pane', '-t', pane.id])) removed.push(pane.id);
  }
  return removed;
}

export function ensureTmuxWorkView(session, { tmux = defaultTmuxRunner, solo = false } = {}) {
  const lane = laneFor(session?.lane);
  const tmuxSession = tmuxSessionFor(session?.location);
  const tmuxWindow = tmuxWindowFor(session?.id);
  const target = `${tmuxSession}:${tmuxWindow}`;
  const logPath = observerLogPath(session);
  if (lane.kind !== 'cli') {
    return { ok: true, created: false, migrated: false, surface: 'api', tmuxSession: null, tmuxWindow: null, target: null, observerPane: null, observerLog: null };
  }
  if (!ensureObserverFile(logPath)) {
    return { ok: false, created: false, migrated: false, surface: 'terminal', tmuxSession, tmuxWindow, target, observerPane: null, observerLog: logPath };
  }
  const command = workViewCommand(session, logPath);
  let created = false;
  if (!tmux(['has-session', '-t', tmuxSession])) {
    tmux(['new-session', '-d', '-s', tmuxSession, '-n', tmuxWindow, '-c', session.workspace, command]);
    if (!tmux(['has-session', '-t', tmuxSession])) {
      return { ok: false, created, migrated: false, surface: 'terminal', tmuxSession, tmuxWindow, target, observerPane: null, observerLog: logPath };
    }
    created = true;
  }

  if (!tmuxWindowExists(tmuxSession, tmuxWindow, tmux)) {
    tmux(['new-window', '-d', '-t', `${tmuxSession}:`, '-n', tmuxWindow, '-c', session.workspace, command]);
    if (!tmuxWindowExists(tmuxSession, tmuxWindow, tmux)) {
      return { ok: false, created, migrated: false, surface: 'terminal', tmuxSession, tmuxWindow, target, observerPane: null, observerLog: logPath };
    }
    created = true;
  }

  let pane = observerPaneFor(target, logPath, tmux, command);
  let migrated = false;
  if (!pane) {
    const paneId = tmux(['split-window', '-h', '-t', target, '-c', session.workspace, '-P', '-F', '#{pane_id}', command]);
    if (typeof paneId === 'string' && paneId.trim()) pane = { id: paneId.trim(), command };
    if (!pane) {
      return { ok: false, created, migrated, surface: 'terminal', tmuxSession, tmuxWindow, target, observerPane: null, observerLog: logPath };
    }
    migrated = true;
  }
  if (pane.id) tmux(['select-pane', '-t', pane.id]);
  const removedPanes = solo ? keepOnlyTmuxPane(target, pane.id, tmux) : [];
  return { ok: true, created, migrated, solo, removedPanes, surface: 'terminal', tmuxSession, tmuxWindow, target, observerPane: pane.id, observerLog: logPath };
}

/**
 * The same debug/status probe for every backend. Terminal lanes (cli kind)
 * attach through the location's tmux session; API lanes honestly report an
 * event/debug view with attach:false. Shape never varies by backend.
 */
export function debugProbe(backend, { session = null, tmux = defaultTmuxRunner } = {}) {
  const lane = laneFor(backend);
  const tmuxSession = session ? tmuxSessionFor(session.location) : null;
  const tmuxWindow = session ? tmuxWindowFor(session.id) : null;
  const target = tmuxSession && tmuxWindow ? `${tmuxSession}:${tmuxWindow}` : null;
  const observerLog = session && lane.kind === 'cli' ? observerLogPath(session) : null;
  const observer = lane.kind === 'cli' && target ? observerPaneFor(target, observerLog, tmux, workViewCommand(session, observerLog)) : null;
  const observerLive = Boolean(observer);
  return {
    backend: lane.backend,
    surface: lane.kind === 'cli' ? 'terminal' : 'api',
    attach: observerLive,
    observerLive,
    observerPane: observer?.id || null,
    observerLog,
    events: true,
    tmuxSession: lane.kind === 'cli' ? tmuxSession : null,
    tmuxWindow: lane.kind === 'cli' ? tmuxWindow : null,
    target: lane.kind === 'cli' ? target : null,
    note: lane.kind === 'cli'
      ? observerLive
        ? `observer live: ${target}`
        : 'observer not running — use /tx on to create one'
      : 'API-only lane: structured events/transcripts only; live attach unavailable',
  };
}

/** Full status view for a session, including its debug probe. */
export function sessionStatus(id, { tmux = defaultTmuxRunner } = {}, storePath = sessionsPath()) {
  const session = getSession(id, storePath);
  if (!session) return null;
  return { ...session, probe: debugProbe(session.lane, { session, tmux }) };
}

/** Patterns that must never reach Telegram. */
const SECRET_PATTERNS = [
  /[A-Za-z_]*TOKEN[A-Za-z_]*\s*[:=]\s*\S+/gi,
  /[A-Za-z_]*KEY[A-Za-z_]*\s*[:=]\s*\S+/gi,
  /[A-Za-z_]*SECRET[A-Za-z_]*\s*[:=]\s*\S+/gi,
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, // telegram bot token shape
];

/** Scrub secret-bearing values out of free text. */
export function scrubSecrets(text) {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

/** Telegram-safe status view: same fields, scrubbed values. */
export function statusForTelegram(id, opts = {}, storePath = sessionsPath()) {
  const status = sessionStatus(id, opts, storePath);
  if (!status) return null;
  return JSON.parse(scrubSecrets(JSON.stringify(status)));
}

function printUsage() {
  console.log('usage: work-session.mjs <resolve|tx|status|debug|handoff|abort> [options]');
  console.log('  resolve --location=L --chat=C --workspace=W [--lane=B]');
  console.log('  tx --session=ID --on|--off');
  console.log('  status --session=ID');
  console.log('  debug --backend=B [--session=ID]');
  console.log('  handoff --session=ID --to=B');
  console.log('  abort --session=ID [--transcript-ref=R]');
}

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (const a of rest) {
    const m = a.match(/^--([^=]+)=(.*)$/s);
    if (m) opts[m[1]] = m[2];
    else if (a.startsWith('--')) opts[a.slice(2)] = '1';
  }
  switch (cmd) {
    case 'resolve':
      console.log(JSON.stringify(resolveSession(opts)));
      break;
    case 'tx': {
      if (!opts.session) throw new Error('tx needs --session=ID');
      const on = opts.on !== undefined || opts.off === undefined;
      console.log(JSON.stringify(setTx(opts.session, on)));
      break;
    }
    case 'status':
      console.log(JSON.stringify(sessionStatus(opts.session), null, 2));
      break;
    case 'debug': {
      const session = opts.session ? getSession(opts.session) : null;
      console.log(JSON.stringify(debugProbe(opts.backend, { session }), null, 2));
      break;
    }
    case 'handoff': {
      const res = handoffSession(opts.session, opts.to);
      if (!res) throw new Error(`unknown session "${opts.session}"`);
      console.log(JSON.stringify(res));
      break;
    }
    case 'abort': {
      const res = abortSession(opts.session, { transcriptRef: opts.transcript_ref || opts.transcriptRef || null });
      if (!res) throw new Error(`unknown session "${opts.session}"`);
      console.log(JSON.stringify(res));
      break;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch((err) => {
    console.error(`work-session: ${err.message}`);
    process.exit(1);
  });
}

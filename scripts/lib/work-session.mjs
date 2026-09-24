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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { laneFor } from './lane-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
  const slug = String(sessionId ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `ws-${slug || 'run'}`;
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

/** Default tmux runner. Injected (fake) in tests. */
export function defaultTmuxRunner(args) {
  try {
    execFileSync('tmux', args, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The same debug/status probe for every backend. Terminal lanes (cli kind)
 * attach through the location's tmux session; API lanes honestly report an
 * event/debug view with attach:false. Shape never varies by backend.
 */
export function debugProbe(backend, { session = null, tmux = defaultTmuxRunner } = {}) {
  const lane = laneFor(backend);
  if (lane.kind === 'cli') {
    const tmuxSession = session ? tmuxSessionFor(session.location) : null;
    const attached = tmuxSession ? tmux(['has-session', '-t', tmuxSession]) : false;
    return {
      backend: lane.backend, surface: 'terminal', attach: attached,
      events: true, tmuxSession,
      note: attached
        ? `attach: tmux attach -t ${tmuxSession}`
        : 'no live tmux session on this host — start one to observe',
    };
  }
  return {
    backend: lane.backend, surface: 'api', attach: false,
    events: true, tmuxSession: null,
    note: 'API-only lane: structured events/transcripts only; live attach unavailable',
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
  /[A-Za-z_]*TOKEN[A-Za-z_]*\s*[:=]\s*\S+/g,
  /[A-Za-z_]*KEY[A-Za-z_]*\s*[:=]\s*\S+/g,
  /[A-Za-z_]*SECRET[A-Za-z_]*\s*[:=]\s*\S+/g,
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

/**
 * todo-notify.mjs — event-driven todo wake-up for the review queue.
 *
 * The sheet is idle most of the time, so nothing polls it. Instead the
 * gateway calls `notifyTodoEvent` fire-and-forget after a successful
 * review verdict (approve / comment / answer): the human's own tap is
 * the trigger. The call records the event and spawns one single-flight,
 * time-boxed TRIAGE session (`opencode run --auto`) that assesses
 * read-only and appends findings. It never fixes, writes, commits, or
 * messages anyone — a fix still needs an explicit go.
 *
 * Guards (all must pass or the event is only recorded):
 * - TODO_AGENT_NOTIFY === '1' (default off; tests never set it, so the
 *   gateway suite cannot spawn processes).
 * - No DISABLED killswitch file in the state dir.
 * - action ∈ approve/comment/answer, key non-empty.
 * - TODO_TRIAGE_ROUTE names a known route (default 'opencode').
 *
 * Routing (adjustable — who the triage can reach):
 * - TODO_TRIAGE_ROUTE=opencode (default): flock single-flight `opencode run`
 *   triage session. This is the starter route — it reaches the opencode
 *   agent surface that owns this box's sheet work.
 * - TODO_TRIAGE_ROUTE=log: record-only. No process is spawned; the inbox
 *   line + attempt receipt are still written. Use it to quiet the box
 *   without losing the event trail, or to add a new route safely.
 * - Anything else: fail closed — event recorded, receipt `unknown_route`,
 *   nothing spawned. Add a route by extending ROUTES, never by string
 *   interpolation of the env value into a shell command.
 *
 * Receipts (why a silent drop is now visible):
 * - Every spawn attempt appends one JSON line to triage-receipts.jsonl
 *   {at, action, key, route, outcome, detail} where outcome ∈ spawned,
 *   spawn_error, unknown_route, record_only, retry_queued, retry_ok,
 *   retry_requeued, retry_exhausted.
 * - The triage child itself must append its completion line to
 *   triage.jsonl (already required by the prompt). Attempt receipt with
 *   no completion receipt inside TRIAGE_TIMEOUT_SEC = the child died
 *   silently (lock contention, timeout kill, opencode failure) — go read
 *   triage-spawn.log for that timestamp.
 * - No polling: retries ride on subsequent verdict events (event-driven).
 *   A failed spawn enqueues {action, key, tries, notBefore}; each later
 *   event drains at most ONE due entry with backoff min(60*tries, 900)s
 *   and drops it after 5 tries (receipt retry_exhausted).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STATE_DIR = path.join(os.homedir(), '.local', 'state', 'sheet-todo-watch');
export const INBOX_PATH = path.join(STATE_DIR, 'inbox.jsonl');
export const TRIAGE_LOG = path.join(STATE_DIR, 'triage.jsonl');
export const LOCK_PATH = path.join(STATE_DIR, 'triage.lock');
export const KILLSWITCH_PATH = path.join(STATE_DIR, 'DISABLED');
export const RECEIPTS_PATH = path.join(STATE_DIR, 'triage-receipts.jsonl');
export const RETRY_PATH = path.join(STATE_DIR, 'triage-retry.jsonl');
export const TRIAGE_TIMEOUT_SEC = 900;
export const RETRY_MAX_TRIES = 5;
export const RETRY_BASE_SEC = 60;
export const RETRY_CAP_SEC = 900;

const VALID_ACTIONS = new Set(['approve', 'comment', 'answer']);

export function wakeEnabled(env = process.env, { exists = fs.existsSync } = {}) {
  if (env.TODO_AGENT_NOTIFY !== '1') return { ok: false, reason: 'TODO_AGENT_NOTIFY is not 1' };
  if (exists(KILLSWITCH_PATH)) return { ok: false, reason: 'killswitch DISABLED present' };
  return { ok: true, reason: '' };
}

export function triagePrompt(action, key) {
  return [
    'TRIAGE ONLY — read-only assessment, no fixes, no writes, no commits, no messages.',
    `A review-app verdict just landed: action=${action} key=${key}.`,
    'Do exactly this: (1) read the sheet row for the key (spreadsheet 10oPI9AsHaKpb9xRR8XcTm6JyH1gYyykUFBNqeqg2SM0, tab current);',
    " (2) if it is a card:tag_* key, read `bugctl packet --id '<tag>' --json` and compare sheet vs canonical;",
    ' (3) run scripts/assert-sheet-proof.mjs and scripts/assert-sheet-canonical-parity.mjs from /home/ubuntu/src/Health-tracker IF present (skip with a note if absent — never fail for that);',
    ` (4) append one JSON line to ${TRIAGE_LOG} with {at, action, key, sheet_state, canonical_state, sensors, needs_go, reason}.`,
    'End with one line: TRIAGE OK (nothing to do) or TRIAGE NEEDS-GO (what fix to authorize).',
  ].join(' ');
}

/**
 * Adjustable routing: who a triage event can reach. The env value selects
 * a key from ROUTES — it is never interpolated into a command. Unknown
 * values fail closed (recorded, nothing spawned).
 */
export function routeFor(env = process.env) {
  const name = String(env.TODO_TRIAGE_ROUTE || 'opencode').trim().toLowerCase() || 'opencode';
  if (name === 'opencode' || name === 'log') return { ok: true, name };
  return { ok: false, name, reason: `unknown TODO_TRIAGE_ROUTE ${name}` };
}

export function retryBackoffSec(tries) {
  return Math.min(RETRY_BASE_SEC * Math.max(1, Number(tries) || 1), RETRY_CAP_SEC);
}

function recordAndSpawn({ inboxType, key, prompt, source, env, deps }) {
  const {
    exists = fs.existsSync,
    mkdir = (d) => fs.mkdirSync(d, { recursive: true }),
    append = (line) => fs.appendFileSync(INBOX_PATH, line + '\n'),
    spawnFn = spawn,
    openLog = (p) => fs.openSync(p, 'a'),
    readRetry = () => readRetryQueue(),
    writeRetry = (entries) => writeRetryQueue(entries),
    now = () => Date.now(),
    receiptSink = (rec) => {
      try {
        fs.appendFileSync(RECEIPTS_PATH, JSON.stringify(rec) + '\n');
      } catch { /* receipts must never break the gateway path */ }
    },
  } = deps;
  const gate = wakeEnabled(env, { exists });
  mkdir(STATE_DIR);
  append(JSON.stringify({ at: new Date().toISOString(), type: inboxType, key, source }));
  const receiptFor = (k) => (outcome, detail = '') => {
    receiptSink({ at: new Date().toISOString(), key: k, route: route.name, outcome, detail });
  };
  const receipt = receiptFor(key);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const route = routeFor(env);
  if (!route.ok) {
    receipt('unknown_route', route.reason);
    return { ok: false, reason: route.reason };
  }
  if (route.name === 'log') {
    receipt('record_only', 'TODO_TRIAGE_ROUTE=log');
    drainRetries({ readRetry, writeRetry, now, receiptFor, attempt: (e) => attemptSpawn({ ...e, env, deps, receipt }) });
    return { ok: true, reason: 'recorded (log route, no spawn)' };
  }
  const r = attemptSpawn({ key, prompt, env, deps, receipt });
  if (!r.ok) enqueueRetry({ action: inboxType, key, now, readRetry, writeRetry, receipt });
  drainRetries({ readRetry, writeRetry, now, receiptFor, attempt: (e) => attemptSpawn({ ...e, env, deps, receipt }) });
  return { ok: true, reason: 'triage spawn attempted (see receipts)' };
}

function attemptSpawn({ key, prompt, env, deps, receipt }) {
  const {
    spawnFn = spawn,
    openLog = (p) => fs.openSync(p, 'a'),
  } = deps;
  const home = os.homedir();
  try {
    const logFd = openLog(path.join(STATE_DIR, 'triage-spawn.log'));
    const child = spawnFn(
      'flock',
      ['-n', LOCK_PATH, 'timeout', String(TRIAGE_TIMEOUT_SEC),
        'opencode', 'run', '--auto', '--title', `sheet-todo triage ${key.slice(0, 40)}`, prompt],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...env, HOME: home, PATH: `${home}/.local/bin:/usr/bin:/bin` },
      },
    );
    if (child && typeof child.unref === 'function') child.unref();
    if (typeof logFd === 'number') { try { fs.closeSync(logFd); } catch { /* already handed off */ } }
  } catch (err) {
    const detail = String((err && err.message) || err);
    receipt('spawn_error', detail);
    return { ok: false, reason: detail };
  }
  receipt('spawned', `flock -n ${LOCK_PATH} timeout ${TRIAGE_TIMEOUT_SEC} opencode run`);
  return { ok: true, reason: 'triage spawned' };
}

function readRetryQueue() {
  try {
    return String(fs.readFileSync(RETRY_PATH, 'utf8')).split('\n')
      .filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function writeRetryQueue(entries) {
  try {
    fs.writeFileSync(RETRY_PATH, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  } catch { /* retry state must never break the gateway path */ }
}

function enqueueRetry({ action, key, now, readRetry, writeRetry, receipt }) {
  try {
    const entries = readRetry().filter((e) => e && e.key);
    const rest = entries.filter((e) => e.action !== action);
    const tries = 1;
    rest.push({ action, key, tries, notBefore: now() + retryBackoffSec(tries) * 1000 });
    writeRetry(rest);
    receipt('retry_queued', `tries=${tries} notBefore=+${retryBackoffSec(tries)}s`);
  } catch { /* never break the gateway path */ }
}

/**
 * Event-driven retry: each verdict event drains at most ONE due entry, so
 * a burst of failures cannot stampede and the gateway path stays fast.
 */
function drainRetries({ readRetry, writeRetry, now, receiptFor, attempt }) {
  let entries;
  try {
    entries = readRetry().filter((e) => e && e.key && e.action);
  } catch {
    return;
  }
  const t = now();
  const due = entries.filter((e) => Number(e.notBefore) <= t).slice(0, 1);
  if (!due.length) return;
  const [entry] = due;
  const rest = entries.filter((e) => e !== entry);
  const prompt = triagePrompt(entry.action.replace(/^review_/, ''), entry.key);
  const r = attempt({ key: entry.key, prompt });
  const entryReceipt = receiptFor(entry.key);
  if (r && r.ok) {
    writeRetry(rest);
    entryReceipt('retry_ok', `${entry.action} after ${entry.tries} tries`);
  } else if (Number(entry.tries) >= RETRY_MAX_TRIES) {
    writeRetry(rest);
    entryReceipt('retry_exhausted', `${entry.action} after ${entry.tries} tries`);
  } else {
    const tries = Number(entry.tries) + 1;
    rest.push({ ...entry, tries, notBefore: t + retryBackoffSec(tries) * 1000 });
    writeRetry(rest);
    entryReceipt('retry_requeued', `tries=${tries} notBefore=+${retryBackoffSec(tries)}s`);
  }
}

/**
 * Fire-and-forget: record + (if guarded) spawn one triage session.
 * Returns synchronously; the child is detached and unrefed.
 */
export function notifyTodoEvent(action, key, env = process.env, deps = {}) {
  const act = String(action || '').trim().toLowerCase();
  const k = String(key || '').trim();
  if (!VALID_ACTIONS.has(act)) return { ok: false, reason: `bad action ${act || '(empty)'}` };
  if (!k) return { ok: false, reason: 'missing key' };
  return recordAndSpawn({ inboxType: `review_${act}`, key: k, prompt: triagePrompt(act, k), source: 'gateway-hook', env, deps });
}


/**
 * todo-notify.mjs — event-driven todo wake-up for the review queue.
 *
 * The sheet is idle most of the time, so nothing polls it. Instead the
 * gateway calls `notifyTodoEvent` fire-and-forget after a successful
 * review verdict (approve / comment / answer): the human's own tap is
 * the trigger. The call records the event and fans out:
 * - comment → one single-flight, time-boxed TRIAGE session
 *   (`opencode run --auto`) that assesses read-only and appends
 *   findings. It never fixes, writes, commits, or messages anyone.
 * - answer → one single-flight, time-boxed WORKER session that continues
 *   the unblocked ticket to `review` or the next question (draft PRs
 *   only, never merge/main/Done/deletes, only that ticket's row). The
 *   owner's answer is the per-ticket go; anything beyond the ticket
 *   still needs a human.
 * - approve → audit only (the gateway already archived Done). No fan-out.
 *
 * Guards (all must pass or the event is only recorded):
 * - TODO_AGENT_NOTIFY === '1' (default off; tests never set it, so the
 *   gateway suite cannot spawn processes).
 * - No DISABLED killswitch file in the state dir.
 * - action ∈ approve/comment/answer, key non-empty.
 * - TODO_TRIAGE_ROUTE names a known route (default 'opencode').
 *
 * Routing (adjustable — who an event can reach):
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
 *   spawn_skipped_locked, spawn_error, unknown_route, record_only,
 *   retry_queued, retry_ok, retry_requeued, retry_exhausted, posted,
 *   post_error, session_gone, sent, send_error, approved_no_fanout.
 * - `spawned` is honest: a synchronous lock probe runs first, so a held
 *   lock receipts `spawn_skipped_locked` (and requeues) instead of a
 *   false `spawned`.
 * - The child must append its completion line to triage.jsonl (triage
 *   assessments use action "triage-batch"/"triage", answer workers use
 *   action "worker"). Attempt receipt with no completion receipt inside
 *   TRIAGE_TIMEOUT_SEC = the child died silently — go read
 *   triage-spawn.log for that timestamp.
 * - session_gone is terminal: the target session id is closed or unknown
 *   (SessionNotFound / HTTP 404 — the CLI exits 0, so stdout must be
 *   inspected, not just the exit code). A gone session never reopens, so
 *   it is NOT retried; refresh TODO_NOTIFY_SESSION_ID instead.
 * - TODO_TRIAGE_MODEL pins the model for `opencode run` triage children
 *   (format provider/model#variant, e.g. acme/worker#high). Unset means
 *   the box default. Set it when the default model is rate-limited: the
 *   child otherwise retries its build loop until the 900s timeout burns
 *   while holding the single-flight lock ("Rate limit exceeded" in
 *   triage-spawn.log with no triage.jsonl line).
 * - No polling: retries ride on subsequent verdict events (event-driven).
 *   A failed spawn enqueues {action, key, tries, notBefore}; each later
 *   event drains at most ONE due entry with backoff min(60*tries, 900)s
 *   and drops it after 5 tries (receipt retry_exhausted).
 */

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STATE_DIR = path.join(os.homedir(), '.local', 'state', 'sheet-todo-watch');
export const INBOX_PATH = path.join(STATE_DIR, 'inbox.jsonl');
export const TRIAGE_LOG = path.join(STATE_DIR, 'triage.jsonl');
export const LOCK_PATH = path.join(STATE_DIR, 'triage.lock');
export const KILLSWITCH_PATH = path.join(STATE_DIR, 'DISABLED');

/** Per-ticket single-flight lock for answer workers: different tickets run
 *  in parallel, the same ticket never runs twice at once. Comment triage
 *  (cheap, read-only) keeps the single global LOCK_PATH as a stampede
 *  throttle. Derived from the key — no mapping file to lose. */
export function lockFor(key) {
  const h = crypto.createHash('sha1').update(String(key || '')).digest('hex').slice(0, 12);
  return path.join(STATE_DIR, `worker-${h}.lock`);
}
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
    ' (5) read the Additional question column: it is the owner Q&A thread. If the latest line is a [human …] answer to an agent question, treat the row as unblocked and assess continuing the work.',
    ' (6) if your model reports rate-limited, write that triage line immediately with needs_go=false and reason=rate-limited, then exit — never retry the build loop.',
    'End with one line: TRIAGE OK (nothing to do) or TRIAGE NEEDS-GO (what fix to authorize).',
  ].join(' ');
}

/**
 * WORKER prompt (answer events only): the owner's answer just unblocked
 * this ticket — continue it to `review` or to the next question. The
 * answer itself is the per-ticket go; anything beyond this ticket still
 * needs a human. Draft PRs only, never merge, never main, never Done.
 */
export function workerPrompt(action, key) {
  return [
    `WORKER — an owner answer just unblocked ticket key=${key} (event ${action}). Continue it, nothing else.`,
    'Do exactly this: (1) read the sheet row (spreadsheet 10oPI9AsHaKpb9xRR8XcTm6JyH1gYyykUFBNqeqg2SM0, tab current) — Status, todo, and the Additional question Q&A thread (the latest [human …] line is your new input);',
    ' (2) claim the row: `ruby /home/ubuntu/.agents/skills/do-github-sync/scripts/claim_ticket.rb --key \'<key>\' --owner "<you> @ vps-france" --session <your-session-id>`;',
    ' (3) do the work in a worktree (`~/dev/new-worktree.sh <area>`, branch agent/<area>), file proof in Drive folder Work done/1G7dhvqRy7iOmRg7AfN9a6g8cbIhz14yS/<key>, open a draft PR if code changed;',
    ' (4) file the row with `sheet_row.rb`: `--status review` when work is complete with proof, or `--status \'Need info\' --question "..."` for a follow-up — the ONLY sheet writer, never raw API;',
    ` (5) append one JSON line to ${TRIAGE_LOG} with {at, action:"worker", key, sheet_state, canonical_state, sensors, needs_go:false, reason}.`,
    'HARD LIMITS: never merge, never push main, never set Done, never delete rows, only touch this key. Sheet writes only via sheet_row.rb.',
    ' (6) rate-limited? File the row Assigned + todo and exit — never retry the build loop.',
    `End with one line: WORKER DONE ${key} <review|need-info|assigned+why>.`,
  ].join(' ');
}

/** Prompt + lock for one event: answers get an acting worker (per-ticket
 *  lock), comments get a read-only triage (global lock). */
export function planFor(action, key) {
  const act = String(action || '').replace(/^review_/, '');
  if (act === 'answer') return { prompt: workerPrompt(act, key), lock: lockFor(key), title: `sheet-todo worker ${key.slice(0, 40)}` };
  return { prompt: triagePrompt(act, key), lock: LOCK_PATH, title: `sheet-todo triage ${key.slice(0, 40)}` };
}
/**
 * Adjustable routing: who a triage event can reach. TODO_TRIAGE_ROUTE is a
 * comma list; each name must be a known lane, else the whole event fails
 * closed (recorded, nothing fired). Names are never interpolated into a
 * shell command. Lanes:
 * - opencode (default starter): flock single-flight `opencode run`
 *   session. Comment events get a read-only triage (global lock);
 *   answer events get an acting worker that continues the ticket to
 *   `review` or the next question (per-ticket lock, so tickets run in
 *   parallel and one ticket never runs twice). Reaches the opencode
 *   agent surface owning this box's work. A pre-spawn lock probe keeps
 *   receipts honest: `spawn_skipped_locked`, never a false `spawned`.
 * - telegram: instant DM to TODO_NOTIFY_CHAT_ID via Telegram sendMessage
 *   (token TODO_NOTIFY_BOT_TOKEN, else TUI_BOT_TOKEN_VM). Reaches the
 *   operator's phone in real time — the push channel the opencode route
 *   lacks. Text carries action + key only, never secrets.
 * - session: posts the verdict text into an opencode session via
 *   `opencode api post /api/session/<id>/prompt` (the CLI carries its own
 *   auth; the hook never handles server credentials). Target is
 *   TODO_NOTIFY_SESSION_ID, set to the live conversation — it MUST be
 *   refreshed when the conversation changes, or verdicts land in a dead
 *   or wrong session. This is how a verdict posts directly into chat.
 *   A dead id receipts `session_gone` (terminal, never retried).
 * - TODO_TRIAGE_MODEL (optional): model for `opencode run` triage in
 *   provider/model#variant form. Validated to safe characters only;
 *   invalid values are ignored (box default used).
 * - log: record-only. No spawn, no send; inbox + receipt still written.
 */
export const KNOWN_LANES = new Set(['opencode', 'telegram', 'session', 'log']);
export function routeFor(env = process.env) {
  const names = String(env.TODO_TRIAGE_ROUTE || 'opencode').split(',')
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
  const lanes = names.length ? names : ['opencode'];
  const bad = lanes.filter((n) => !KNOWN_LANES.has(n));
  if (bad.length) return { ok: false, lanes, reason: `unknown TODO_TRIAGE_ROUTE lane(s): ${bad.join(',')}` };
  return { ok: true, lanes };
}

export function verdictText(action, key) {
  const act = String(action || '').replace(/^review_/, '');
  if (act === 'answer') return `Review answer: ${key} — worker continuing, trail in sheet-todo-watch.`;
  return `Review ${act}: ${key} — triage assessing, trail in sheet-todo-watch.`;
}

/**
 * The `opencode api post` CLI exits 0 even when the session is gone (it
 * prints SessionNotFoundError + HTTP 404 as the response body), so the
 * exit code cannot tell posted from gone — stdout must be inspected.
 */
export function isSessionGoneText(s) {
  return /sessionnotfound|session not found|no such session|unknown session|\b404\b/i.test(String(s || ''));
}

/**
 * Optional model pin for triage children (TODO_TRIAGE_MODEL, form
 * provider/model#variant). Strict allowlist — never interpolate raw env
 * into the spawn argv. Returns [] (box default) when unset or invalid.
 */
export function triageModelArgs(env = process.env) {
  const m = String(env.TODO_TRIAGE_MODEL || '').trim();
  if (!m) return [];
  if (m.length > 120 || !m.includes('/')) return [];
  if (!/^[A-Za-z0-9_./#:@+~=-]+$/.test(m)) return [];
  return ['--model', m];
}

export function retryBackoffSec(tries) {
  return Math.min(RETRY_BASE_SEC * Math.max(1, Number(tries) || 1), RETRY_CAP_SEC);
}

function recordAndSpawn({ inboxType, key, source, env, deps }) {
  const {
    exists = fs.existsSync,
    mkdir = (d) => fs.mkdirSync(d, { recursive: true }),
    append = (line) => fs.appendFileSync(INBOX_PATH, line + '\n'),
    spawnFn = spawn,
    openLog = (p) => fs.openSync(p, 'a'),
    execSyncFn = execFileSync,
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
    receiptSink({ at: new Date().toISOString(), key: k, route: route.lanes.join('+'), outcome, detail });
  };
  const receipt = receiptFor(key);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const route = routeFor(env);
  if (!route.ok) {
    receiptSink({ at: new Date().toISOString(), key, route: '', outcome: 'unknown_route', detail: route.reason });
    return { ok: false, reason: route.reason };
  }
  if (inboxType === 'review_approve') {
    // An approval finishes the work by itself (gateway archives Done):
    // nothing to assess, nobody to page. Record the audit line and drain
    // pending retries, but fan out no lanes and spawn no triage.
    receipt('approved_no_fanout', 'approve needs no notify and no triage');
    drainRetries({ readRetry, writeRetry, now, receiptFor, attempt: (e) => redispatchEntry({ ...e, env, deps, receipt: receiptFor(e.key), readRetry, writeRetry, now }) });
    return { ok: true, reason: 'approve recorded, no fan-out' };
  }
  const plan = planFor(inboxType, key);
  for (const lane of route.lanes) {
    if (lane === 'log') {
      receipt('record_only', 'lane=log');
      continue;
    }
    if (lane === 'telegram') {
      dispatchTelegram({ action: inboxType, key, tries: 0, env, deps, receipt, readRetry, writeRetry, now });
      continue;
    }
    if (lane === 'session') {
      const r = attemptSessionPost({ action: inboxType, key, env, deps, receipt });
      // A gone session never reopens: terminal, no retry. Anything else
      // transient keeps the bounded retry.
      if (!r.ok && !r.gone) enqueueRetry({ route: lane, action: inboxType, key, tries: 0, now, readRetry, writeRetry, receipt });
      continue;
    }
    const r = attemptSpawn({ key, plan, env, deps, receipt });
    // Locked and crashed alike requeue bounded: the next event retries.
    // Only the terminal session_gone (other lane) drops without retry.
    if (!r.ok) enqueueRetry({ route: lane, action: inboxType, key, tries: 0, now, readRetry, writeRetry, receipt });
  }
  drainRetries({ readRetry, writeRetry, now, receiptFor, attempt: (e) => redispatchEntry({ ...e, env, deps, receipt: receiptFor(e.key), readRetry, writeRetry, now }) });
  return { ok: true, reason: 'event fanned out (see receipts)' };
}

/**
 * Posts the verdict into a live opencode session (the chat itself) via the
 * `opencode api` CLI, which carries its own server auth — the hook never
 * sees credentials. Synchronous, bounded (15s timeout): the CLI is local
 * and fast. Returns {ok} so failures enqueue retries like every lane.
 */
export function attemptSessionPost({ action, key, env, deps, receipt }) {
  const { execSyncFn = execFileSync } = deps;
  const sessionId = String(env.TODO_NOTIFY_SESSION_ID || '').trim();
  if (!sessionId) {
    receipt('post_error', 'no TODO_NOTIFY_SESSION_ID');
    return { ok: false, reason: 'no session id' };
  }
  const text = `[verdict] ${verdictText(action, key)}`;
  const gone = (detail) => {
    receipt('session_gone', `session ${sessionId.slice(0, 12)}… gone — refresh TODO_NOTIFY_SESSION_ID (${detail})`.slice(0, 200));
    return { ok: false, gone: true, reason: 'session gone' };
  };
  try {
    const out = execSyncFn('opencode', ['api', 'post', `/api/session/${sessionId}/prompt`, '--data', JSON.stringify({ text })],
      { timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    const body = out == null ? '' : String(out);
    if (isSessionGoneText(body)) return gone('SessionNotFound');
  } catch (err) {
    const parts = [err && err.message, err && err.stderr, err && err.stdout]
      .map((p) => (p == null ? '' : String(p))).join('\n');
    if (isSessionGoneText(parts)) return gone('SessionNotFound');
    const detail = String((err && err.message) || err).slice(0, 200);
    receipt('post_error', detail);
    return { ok: false, reason: detail };
  }
  receipt('posted', `session ${sessionId.slice(0, 12)}…`);
  return { ok: true, reason: 'verdict posted to session' };
}

function telegramTarget(env = process.env) {  const token = String(env.TODO_NOTIFY_BOT_TOKEN || env.TUI_BOT_TOKEN_VM || '').trim();
  const chatId = String(env.TODO_NOTIFY_CHAT_ID || '').trim();
  if (!token) return { ok: false, reason: 'no bot token (TODO_NOTIFY_BOT_TOKEN nor TUI_BOT_TOKEN_VM)' };
  if (!chatId) return { ok: false, reason: 'no TODO_NOTIFY_CHAT_ID' };
  return { ok: true, token, chatId };
}

/**
 * Fire-and-forget Telegram send: validates synchronously, settles async.
 * Every outcome writes a receipt; failures re-enqueue (bounded, see
 * enqueueRetry). The token never appears in any receipt or log.
 */
function dispatchTelegram({ action, key, tries, env, deps, receipt, readRetry, writeRetry, now }) {
  const { fetchFn = fetch } = deps;
  const target = telegramTarget(env);
  if (!target.ok) {
    receipt('send_error', target.reason);
    enqueueRetry({ route: 'telegram', action, key, tries, now, readRetry, writeRetry, receipt });
    return;
  }
  const text = verdictText(String(action || '').replace(/^review_/, ''), key);
  let settled = false;
  const fail = (detail) => {
    if (settled) return;
    settled = true;
    receipt('send_error', String(detail).slice(0, 200));
    enqueueRetry({ route: 'telegram', action, key, tries, now, readRetry, writeRetry, receipt });
  };
  let res;
  try {
    res = fetchFn(`https://api.telegram.org/bot${target.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: target.chatId, text }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    fail((err && err.message) || err);
    return;
  }
  Promise.resolve(res).then(
    async (r) => {
      if (!r || !r.ok) return fail(`telegram HTTP ${r ? r.status : 'no-response'}`);
      let mid = '';
      try {
        const body = await r.json();
        mid = String((body && body.result && body.result.message_id) || '');
      } catch { /* id is nice-to-have */ }
      if (settled) return;
      settled = true;
      receipt('sent', mid ? `message_id ${mid}` : 'ok');
    },
    (err) => fail((err && err.message) || err),
  );
}

function redispatchEntry({ route, action, key, tries, env, deps, receipt, readRetry, writeRetry, now }) {
  if (route === 'telegram') {
    dispatchTelegram({ action, key, tries, env, deps, receipt, readRetry, writeRetry, now });
    return undefined;
  }
  if (route === 'session') {
    return attemptSessionPost({ action, key, env, deps, receipt });
  }
  return attemptSpawn({ key, plan: planFor(action, key), env, deps, receipt });
}

function attemptSpawn({ key, plan, env, deps, receipt }) {
  const {
    spawnFn = spawn,
    openLog = (p) => fs.openSync(p, 'a'),
    execSyncFn = execFileSync,
  } = deps;
  const home = os.homedir();
  const modelArgs = triageModelArgs(env);
  const modelFlag = modelArgs.length ? ` --model ${modelArgs[1]}` : '';
  // Honest single-flight: probe the lock synchronously first. A held lock
  // receipts spawn_skipped_locked (bounded retry follows) instead of a
  // false spawned whose flock child would exit without doing anything.
  try {
    execSyncFn('flock', ['-n', plan.lock, 'true'], { timeout: 5000, stdio: 'ignore' });
  } catch {
    receipt('spawn_skipped_locked', `held: ${plan.lock}`);
    return { ok: false, locked: true, reason: 'lock held' };
  }
  try {
    const logFd = openLog(path.join(STATE_DIR, 'triage-spawn.log'));
    const child = spawnFn(
      'flock',
      ['-n', plan.lock, 'timeout', String(TRIAGE_TIMEOUT_SEC),
        'opencode', 'run', '--auto', ...modelArgs, '--title', plan.title, plan.prompt],
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
  receipt('spawned', `flock -n ${plan.lock} timeout ${TRIAGE_TIMEOUT_SEC} opencode run${modelFlag}`);
  return { ok: true, reason: 'spawned' };
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

function enqueueRetry({ route, action, key, tries, now, readRetry, writeRetry, receipt }) {
  const next = Number(tries || 0) + 1;
  if (next > RETRY_MAX_TRIES) {
    receipt('retry_exhausted', `${action} after ${tries} tries`);
    return;
  }
  try {
    const entries = readRetry().filter((e) => e && e.key);
    const rest = entries.filter((e) => !(e.route === route && e.action === action && e.key === key));
    rest.push({ route, action, key, tries: next, notBefore: now() + retryBackoffSec(next) * 1000 });
    writeRetry(rest);
    receipt(next === 1 ? 'retry_queued' : 'retry_requeued', `tries=${next} notBefore=+${retryBackoffSec(next)}s`);
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
  const entryReceipt = receiptFor(entry.key);
  const r = attempt({ route: entry.route || 'opencode', key: entry.key, action: entry.action, tries: entry.tries });
  if (r && r.gone) {
    // Terminal: the target session is gone and never reopens. Drop the
    // entry (the session_gone receipt is already written) — no requeue.
    writeRetry(rest);
    return;
  }
  if (entry.route === 'telegram') {
    // Fire-and-forget: the entry is dropped now; async settle re-enqueues
    // itself on failure, or writes 'sent' on success.
    writeRetry(rest);
    return;
  }
  if (r && r.ok) {
    writeRetry(rest);
    entryReceipt('retry_ok', `${entry.action} after ${entry.tries} tries`);
    return;
  }
  writeRetry(rest);
  enqueueRetry({ route: entry.route || 'opencode', action: entry.action, key: entry.key,
    tries: entry.tries, now, readRetry, writeRetry, receipt: entryReceipt });
}

/**
 * Fire-and-forget: record + (if guarded) fan out one event.
 * Answers continue the ticket (worker), comments assess it (triage),
 * approves record audit only. Returns synchronously; children are
 * detached and unrefed.
 */
export function notifyTodoEvent(action, key, env = process.env, deps = {}) {
  const act = String(action || '').trim().toLowerCase();
  const k = String(key || '').trim();
  if (!VALID_ACTIONS.has(act)) return { ok: false, reason: `bad action ${act || '(empty)'}` };
  if (!k) return { ok: false, reason: 'missing key' };
  return recordAndSpawn({ inboxType: `review_${act}`, key: k, source: 'gateway-hook', env, deps });
}


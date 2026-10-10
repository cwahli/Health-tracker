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
export const TRIAGE_TIMEOUT_SEC = 900;

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
 * Fire-and-forget: record + (if guarded) spawn one triage session.
 * Returns synchronously; the child is detached and unrefed.
 */
export function notifyTodoEvent(action, key, env = process.env, deps = {}) {
  const {
    exists = fs.existsSync,
    mkdir = (d) => fs.mkdirSync(d, { recursive: true }),
    append = (line) => fs.appendFileSync(INBOX_PATH, line + '\n'),
    spawnFn = spawn,
    openLog = (p) => fs.openSync(p, 'a'),
  } = deps;
  const act = String(action || '').trim().toLowerCase();
  const k = String(key || '').trim();
  if (!VALID_ACTIONS.has(act)) return { ok: false, reason: `bad action ${act || '(empty)'}` };
  if (!k) return { ok: false, reason: 'missing key' };
  const gate = wakeEnabled(env, { exists });
  mkdir(STATE_DIR);
  append(JSON.stringify({ at: new Date().toISOString(), type: `review_${act}`, key: k, source: 'gateway-hook' }));
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const prompt = triagePrompt(act, k);
  const logFd = openLog(path.join(STATE_DIR, 'triage-spawn.log'));
  const home = os.homedir();
  const child = spawnFn(
    'flock',
    ['-n', LOCK_PATH, 'timeout', String(TRIAGE_TIMEOUT_SEC),
      'opencode', 'run', '--auto', '--title', `sheet-todo triage ${act} ${k}`, prompt],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...env, HOME: home, PATH: `${home}/.local/bin:/usr/bin:/bin` },
    },
  );
  if (child && typeof child.unref === 'function') child.unref();
  if (typeof logFd === 'number') { try { fs.closeSync(logFd); } catch { /* already handed off */ } }
  return { ok: true, reason: 'triage spawned' };
}

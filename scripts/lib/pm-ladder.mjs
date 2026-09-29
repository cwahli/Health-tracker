/**
 * pm-ladder.mjs — responsibility 2 of the PM role: the ladder and its counters.
 *
 * WHY THE COUNTER IS ON DISK AND NOT IN MEMORY
 * --------------------------------------------
 * The whole point of `retry → find another way → escalate` is that the third
 * rung is *earned*. A counter held in the process that is doing the nudging
 * resets on every host restart, and a bot host restarts often — a deploy, an
 * OOM, a `systemctl restart`. After a restart the ladder would begin again at
 * `retry`, so a project that cannot progress would be nudged forever and never
 * escalated. The counter therefore lives in a file (`~/.local/state/bot-host/
 * <botId>/pm-ladder.json`, mode 600), written atomically, and a fresh process
 * reads it back. That is the property the sensor proves by running the ladder in
 * three separate processes.
 *
 * WHY THE RUNGS ARE NAMED, NOT NUMBERED
 * -------------------------------------
 * A rung is an instruction to a stalled agent, so it has to be sayable. "Rung 2"
 * means nothing in a chat; "you have changed the same file three times without
 * passing a gate — find another way" is the actual message. `rungMessage()` is
 * that mapping, kept next to `nextRung()` so a new rung cannot be added without
 * the sentence that delivers it.
 *
 * WHAT THIS FILE DOES NOT DO
 * --------------------------
 * It does not decide *which* items are stalled (`pm-fleet.mjs` owns that) and it
 * does not send anything (`pm-run.mjs` owns delivery). It answers one question:
 * given everything this item has already been told, what is the next rung?
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The ladder, in order. The last rung is the one that stops and asks the human. */
export const RUNGS = ['retry', 'another-way', 'escalate'];

/** How many attempts a rung may be repeated before the ladder must move on. */
export const MAX_PER_RUNG = 1;

/** Keep the per-item history bounded; the counter is the fact, the trail is context. */
export const MAX_HISTORY = 10;

export const RUNG_LABELS = {
  retry: 'retry',
  'another-way': 'find another way',
  escalate: 'escalate to you',
};

/**
 * Attempts already recorded → the rung the NEXT attempt uses.
 *
 * `prior` is the number of attempts already made (0 on the first run). The rung
 * is one step along the ladder per attempt, and `escalate` is sticky: once the
 * ladder has asked the human, it keeps asking rather than dropping back to an
 * automated retry the agent has already failed twice.
 */
export function nextRung(prior) {
  const n = Math.max(0, Number(prior) || 0);
  if (n < 1 * MAX_PER_RUNG) return RUNGS[0];
  if (n < 2 * MAX_PER_RUNG) return RUNGS[1];
  return RUNGS[2];
}

/** The sentence that delivers a rung. `item` supplies the id and the reason. */
export function rungMessage(rung, item = {}) {
  const id = String(item.id || item.key || 'this work').trim();
  const why = String(item.stallReason || 'it is not moving').trim();
  switch (rung) {
    case 'retry':
      return `${id} is stalled: ${why}. Retry it — resume the work and push past that step.`;
    case 'another-way':
      return `${id} is still stalled after a retry: ${why}. The previous approach did not work — find another way (different file, different lane, or a smaller step) instead of repeating it.`;
    default:
      return `Decision needed: ${id} has stalled twice — a retry and a re-plan both failed (${why}). Stop and hand it to the operator rather than starting a third automated attempt.`;
  }
}

/** The PM's durable state for one bot. One file, so a restart cannot lose a step. */
export function ladderFile(botId, { home = os.homedir() } = {}) {
  const id = String(botId || 'vm').trim() || 'vm';
  return path.join(home, '.local', 'state', 'bot-host', id, 'pm-ladder.json');
}

const EMPTY = () => ({ version: 1, counters: {} });

/** Read the ladder state. A missing or torn file reads as empty rather than throwing. */
export function readLadder(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return EMPTY();
    return { version: 1, counters: parsed.counters && typeof parsed.counters === 'object' ? parsed.counters : {} };
  } catch {
    return EMPTY();
  }
}

/**
 * Write the ladder state atomically (temp file + rename) and mode 600.
 *
 * A partial write would silently rewind a counter, which is the exact failure
 * this file exists to prevent, so the write either lands whole or not at all.
 */
export function writeLadder(file, state) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const text = JSON.stringify(state, null, 2) + '\n';
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  return file;
}

/** What this item has been told so far. */
export function attemptFor(state, key) {
  const entry = state?.counters?.[String(key)];
  return {
    attempts: Number(entry?.attempts || 0),
    rung: String(entry?.rung || ''),
    firstAt: String(entry?.firstAt || ''),
    lastAt: String(entry?.lastAt || ''),
    history: Array.isArray(entry?.history) ? entry.history : [],
  };
}

/**
 * Record one attempt and return what was recorded.
 *
 * The rung is derived from the counter BEFORE this attempt, so the first call on
 * a new item returns `retry` and the third returns `escalate`. The whole state
 * is rewritten through `writeLadder`, so the caller sees the counter that a
 * restarted process will read.
 */
export function recordAttempt(file, { key, at = new Date().toISOString(), note = '' } = {}) {
  const id = String(key || '').trim();
  if (!id) return { ok: false, reason: 'recordAttempt needs a key' };
  const state = readLadder(file);
  const prior = attemptFor(state, id);
  const rung = nextRung(prior.attempts);
  const entry = {
    attempts: prior.attempts + 1,
    rung,
    firstAt: prior.firstAt || at,
    lastAt: at,
    history: [...prior.history, { at, rung, note: String(note).slice(0, 200) }].slice(-MAX_HISTORY),
  };
  state.counters[id] = entry;
  writeLadder(file, state);
  return {
    ok: true,
    key: id,
    attempts: entry.attempts,
    rung,
    label: RUNG_LABELS[rung],
    escalated: rung === 'escalate',
    priorAttempts: prior.attempts,
    file,
  };
}

/**
 * Record one attempt for several items in a single read-modify-write.
 *
 * The cycle nudges a handful of items at once; doing that through `recordAttempt`
 * would rewrite (and fsync-order) the whole file once per item. Same result, one
 * write.
 */
export function recordAttempts(file, entries = []) {
  const state = readLadder(file);
  const results = [];
  for (const { key, at = new Date().toISOString(), note = '' } of entries) {
    const id = String(key || '').trim();
    if (!id) continue;
    const prior = attemptFor(state, id);
    const rung = nextRung(prior.attempts);
    const entry = {
      attempts: prior.attempts + 1,
      rung,
      firstAt: prior.firstAt || at,
      lastAt: at,
      history: [...prior.history, { at, rung, note: String(note).slice(0, 200) }].slice(-MAX_HISTORY),
    };
    state.counters[id] = entry;
    results.push({
      ok: true,
      key: id,
      attempts: entry.attempts,
      rung,
      label: RUNG_LABELS[rung],
      escalated: rung === 'escalate',
      priorAttempts: prior.attempts,
      file,
    });
  }
  if (results.length) writeLadder(file, state);
  return results;
}

/** Drop counters for work that is no longer stalled, so the file cannot grow forever. */
export function forgetCounters(file, keepKeys = []) {
  const keep = new Set((keepKeys || []).map(String));
  const state = readLadder(file);
  let dropped = 0;
  for (const key of Object.keys(state.counters)) {
    if (!keep.has(key)) {
      delete state.counters[key];
      dropped += 1;
    }
  }
  if (dropped) writeLadder(file, state);
  return dropped;
}

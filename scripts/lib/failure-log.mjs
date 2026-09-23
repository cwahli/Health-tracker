/**
 * Structured bot-failure recorder — the sensor side of the learning loop.
 *
 * Best practice: every bot failure is recorded as a structured row
 * (when / lane / kind / hint), never as free text alone, so repeats can be
 * grouped by signature and converted into durable learnings (test, guard,
 * skill, or capability update) instead of being debugged twice.
 *
 * Store is host-local (default ~/.hermes/bot-failures.jsonl, override with
 * BOT_FAILURE_LOG) — one JSON object per line, append-only, best-effort.
 * Recording must never break a run: all I/O is wrapped, disable with
 * BOT_FAILURE_LOG=0.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function failureLogPath() {
  if (process.env.BOT_FAILURE_LOG === '0') return null;
  return process.env.BOT_FAILURE_LOG || path.join(os.homedir(), '.hermes', 'bot-failures.jsonl');
}

/** Build a failure row. `kind` should be the shared-vocabulary reason (short). */
export function buildFailure({ lane = null, kind = 'unknown', hint = '', bot = null, at = null } = {}) {
  return {
    at: at || new Date().toISOString(),
    bot,
    lane,
    kind: String(kind || 'unknown').slice(0, 160),
    hint: String(hint || '').slice(0, 160),
  };
}

/** Append a row; never throws. Returns true when written. */
export function recordFailure(row, logPath = failureLogPath()) {
  try {
    if (!logPath) return false;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(buildFailure(row)) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Load all rows; corrupt lines are skipped, never fatal. */
export function loadFailures(logPath = failureLogPath()) {
  try {
    if (!logPath || !fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Group rows by (kind → lane) signature for review. Returns
 * [{ kind, lanes: {lane: count}, count, first, last, hint }] newest last.
 */
export function groupFailures(rows) {
  const byKind = new Map();
  for (const r of rows) {
    const kind = r.kind || 'unknown';
    if (!byKind.has(kind)) byKind.set(kind, { kind, lanes: {}, count: 0, first: r.at, last: r.at, hint: '' });
    const g = byKind.get(kind);
    g.count += 1;
    g.lanes[r.lane || '?'] = (g.lanes[r.lane || '?'] || 0) + 1;
    if (r.at < g.first) g.first = r.at;
    if (r.at > g.last) { g.last = r.at; if (r.hint) g.hint = r.hint; }
    else if (!g.hint && r.hint) g.hint = r.hint;
  }
  return [...byKind.values()].sort((a, b) => b.count - a.count);
}

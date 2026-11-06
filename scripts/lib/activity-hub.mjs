/**
 * Unified activity view over the records every bot turn already writes.
 *
 * Sources (all produced today, none read for display until now):
 * - work-session rows (`work-sessions.json`: id = `chat|project`, lane,
 *   tx/viewMode, opencodeSessionId) — the observer log filename is
 *   `sha256(row.id)`, so rows and logs join 1:1,
 * - chat -> session bindings (`sessions.json`, workspace-scoped opencode ids),
 * - live runs (`leases.json`: chat -> { startedAt, ... }),
 * - held chats (blocked-location rows: chat -> { requested, reason }),
 * - per-session observer logs (`~/.hermes/work-observers/session-<sha>.log`).
 *
 * Pure + injected: callers pass plain data (arrays/Maps), so this file does
 * no fs, no env, no clock except the injected `now`. The gateway builds the
 * inputs from disk; tests build them by hand.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Must stay byte-identical to work-session.mjs observerLogPath. */
export function observerDigest(workRowId) {
  return createHash('sha256').update(String(workRowId ?? '')).digest('hex');
}

/** File name (no directory) of the observer log for a work-session row id. */
export function observerFileName(workRowId) {
  return `session-${observerDigest(workRowId)}.log`;
}

/**
 * Map an observer-log file name back to its work-row id via a digest -> id
 * index. Accepts the rotated sibling (`session-<sha>.log.1`). Returns the
 * row id or null when the name is not an observer log or is unbound.
 */
export function rowForObserverFile(fileName, digestToRow) {
  const base = String(fileName ?? '').split('/').pop();
  const m = /^session-([0-9a-f]{64})\.log(?:\.1)?$/.exec(base);
  if (!m) return null;
  const hit = digestToRow?.get?.(m[1]);
  return hit == null ? null : String(hit);
}

/**
 * Join work rows + bindings + leases + held + observer files into one list.
 *
 * workRows: [{ id, chat, workspace, lane, location, tx, viewMode,
 *               opencodeSessionId }] (work-sessions.json rows)
 * bindings: Map chat -> { workspace, sessionId, bots: [botId] }
 *   (sessions.json per bot dir, scope split)
 * leases: Map chat -> { startedAt, bots: [botId] } (a present entry with a
 *   finite startedAt means working now; bots accumulate across pollers)
 * blocked: Map chat -> { requested, reason } (held: unreachable host)
 * observerFiles: Map digest -> { mtimeMs, lastEvent } (lastEvent may be null)
 *
 * State precedence: working > held > idle. A missing observer file degrades
 * the row to unknown recency, never drops it.
 */
export function collectActivity({
  workRows = [],
  bindings = new Map(),
  leases = new Map(),
  blocked = new Map(),
  observerFiles = new Map(),
  now = Date.now(),
} = {}) {
  const rows = [];
  for (const w of workRows) {
    const id = String(w?.id ?? '');
    if (!id) continue;
    const chat = String(w?.chat ?? id.split('|')[0] ?? '');
    const binding = bindings?.get?.(chat);
    const file = observerFiles?.get?.(observerDigest(id));
    const lease = leases?.get?.(chat);
    const hold = blocked?.get?.(chat);
    let state = 'idle';
    let elapsedMs = null;
    if (lease && Number.isFinite(Number(lease.startedAt))) {
      state = 'working';
      elapsedMs = Math.max(0, Number(now) - Number(lease.startedAt));
    } else if (hold) {
      state = 'held';
    }
    const sessionId = String(binding?.sessionId ?? w?.opencodeSessionId ?? '');
    const botSet = new Set([
      ...((binding?.bots ?? []).map(String)),
      ...((lease?.bots ?? []).map(String)),
    ]);
    rows.push({
      chat,
      project: id.split('|').slice(1).join('|'),
      sessionId8: sessionId ? sessionId.slice(0, 12) : '',
      bots: [...botSet].sort(),
      workspace: String(binding?.workspace ?? w?.workspace ?? ''),
      lane: String(w?.lane ?? ''),
      host: String(w?.location ?? hold?.requested ?? ''),
      tx: Boolean(w?.tx),
      viewMode: String(w?.viewMode ?? ''),
      state,
      elapsedMs,
      lastEventAt: file && Number.isFinite(Number(file.mtimeMs)) ? Number(file.mtimeMs) : null,
      lastEvent: file?.lastEvent == null ? null : String(file.lastEvent),
    });
  }
  // Working first (longest-running top), then held, then idle by recency.
  const rank = { working: 0, held: 1, idle: 2 };
  rows.sort((a, b) =>
    (rank[a.state] ?? 3) - (rank[b.state] ?? 3) ||
    (b.elapsedMs ?? -1) - (a.elapsedMs ?? -1) ||
    (b.lastEventAt ?? -1) - (a.lastEventAt ?? -1),
  );
  return rows;
}

function readJsonFile(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Last log line's record type, from the tail — cheap on a 1 MB file. */
function tailEventType(file) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, 4096);
    if (len <= 0) return null;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const rec = JSON.parse(lines[i]);
          if (rec && typeof rec.type === 'string') return rec.type;
        } catch { /* keep scanning older lines */ }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch { /* unreadable: unknown recency detail */ }
  return null;
}

/**
 * Build collectActivity inputs from disk. Best-effort throughout: every read
 * is guarded, nothing here mkdirs or writes, and the result is always a
 * complete (possibly empty) input set — the gateway never fails status
 * because the hub could not read.
 */
export function readActivityInputs({ home = os.homedir() } = {}) {
  const empty = {
    workRows: [], bindings: new Map(), leases: new Map(),
    blocked: new Map(), observerFiles: new Map(),
  };
  try {
    const store = readJsonFile(path.join(home, '.hermes', 'work-sessions.json'), null);
    const rows = store && typeof store.sessions === 'object' ? Object.values(store.sessions) : [];
    empty.workRows = rows.filter((r) => r && typeof r.id === 'string');
  } catch { /* degraded below */ }
  try {
    const root = path.join(home, '.local', 'state', 'bot-host');
    for (const bot of fs.readdirSync(root)) {
      const dir = path.join(root, bot);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
      } catch { continue; }
      const sessions = readJsonFile(path.join(dir, 'sessions.json'), {});
      for (const [chat, v] of Object.entries(sessions)) {
        if (typeof v !== 'string') continue;
        const cut = v.indexOf('\u0000');
        if (cut === -1) continue;
        const key = String(chat);
        const prev = empty.bindings.get(key);
        empty.bindings.set(key, {
          workspace: v.slice(0, cut),
          sessionId: v.slice(cut + 1),
          bots: [...new Set([...(prev?.bots ?? []), bot])].sort(),
        });
      }
      const leases = readJsonFile(path.join(dir, 'leases.json'), {});
      for (const [chat, v] of Object.entries(leases)) {
        if (v && Number.isFinite(Number(v.startedAt))) {
          const key = String(chat);
          const prev = empty.leases.get(key);
          empty.leases.set(key, {
            startedAt: Math.max(Number(v.startedAt), Number(prev?.startedAt ?? -Infinity)),
            bots: [...new Set([...(prev?.bots ?? []), bot])].sort(),
          });
        }
      }
    }
  } catch { /* no bot state: hub still answers from work rows */ }
  try {
    const blocked = readJsonFile(path.join(home, '.hermes', 'location_state.json'), {});
    for (const [chat, v] of Object.entries(blocked)) {
      if (v && typeof v.requested === 'string') empty.blocked.set(String(chat), { requested: v.requested, reason: String(v.reason || '') });
    }
  } catch { /* no holds */ }
  try {
    const dir = path.join(home, '.hermes', 'work-observers');
    for (const name of fs.readdirSync(dir)) {
      const m = /^session-([0-9a-f]{64})\.log(\.1)?$/.exec(name);
      if (!m || m[2]) continue; // rotated sibling: same conversation, skip
      const file = path.join(dir, name);
      let mtimeMs = null;
      try { mtimeMs = fs.statSync(file).mtimeMs; } catch { continue; }
      empty.observerFiles.set(m[1], { mtimeMs, lastEvent: tailEventType(file) });
    }
  } catch { /* no observer logs yet */ }
  return empty;
}

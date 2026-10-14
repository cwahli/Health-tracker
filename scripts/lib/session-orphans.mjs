/**
 * Orphan opencode sessions: ids the server keeps that no chat owns.
 *
 * Steady-state turns bind back their session id, so orphans come only from
 * the exceptions: /new and /project drops (binding deleted, server session
 * kept), stale-session repair (ghost id abandoned for a fresh run), and
 * Cline's fresh-thread-per-message. This file owns two things:
 *
 * - validateAttachTarget(): the /attach gate — the id must be an opencode
 *   session on THIS box's store, in the chat's exact workspace, with its
 *   size attached so the caller can warn before a heavy attach.
 * - the orphan list: /new + /project register the abandoned id here instead
 *   of dropping it silently; /attach unregisters; the reaper (dry-run
 *   first, archive only) consumes it.
 *
 * Read-only against the opencode store; the orphan list file is the only
 * write, and every helper is injected (home/dbPath) for tests.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Over ~500 msgs / ~2 MB history an attach drags real weight every turn. */
export const ATTACH_WARN_MSGS = 500;
export const ATTACH_WARN_BYTES = 2 * 1024 * 1024;

export function attachNeedsConfirm({ msgs = 0, bytes = 0 } = {}) {
  return Number(msgs) >= ATTACH_WARN_MSGS || Number(bytes) >= ATTACH_WARN_BYTES;
}

export function formatBytes(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b < 0) return '?';
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

let _DatabaseSync = null;
let _sqliteTried = false;
function sqliteDriver() {
  if (!_sqliteTried) {
    _sqliteTried = true;
    try {
      _DatabaseSync = createRequire(import.meta.url)('node:sqlite').DatabaseSync;
    } catch {
      _DatabaseSync = null;
    }
  }
  return _DatabaseSync;
}

function opencodeDb(dbPath, home) {
  const file = dbPath || path.join(home, '.local', 'share', 'opencode', 'opencode.db');
  try {
    if (!fs.existsSync(file)) return null;
    const Driver = sqliteDriver();
    if (!Driver) return null;
    return new Driver(file, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * Gate for /attach. Never throws: every failure is a chat-readable reason.
 * `workspace` is the chat's current workspace — exact match required, the
 * same rule sessionForWorkspace enforces on the turn path.
 */
export function validateAttachTarget({ sessionId = '', workspace = '', dbPath = null, home = os.homedir() } = {}) {
  const sid = String(sessionId || '').trim();
  if (!/^ses_[A-Za-z0-9]+$/.test(sid)) {
    return {
      ok: false,
      reason: 'not an opencode session id — Cline threads and other ids cannot attach (opencode lanes only). Copy the id from your opencode session list.',
    };
  }
  const db = opencodeDb(dbPath, home);
  if (!db) return { ok: false, reason: 'the session store is unreadable right now — try again in a bit.' };
  try {
    const row = db.prepare('select id, directory, title, time_archived from session_v2 where id = ?').get(sid);
    if (!row) return { ok: false, reason: 'unknown session on this machine — it may live on another host or never have existed here.' };
    if (row.time_archived != null) return { ok: false, reason: 'that session is archived — unarchive it first, or pick a live one.' };
    const dir = String(row.directory || '');
    if (dir !== String(workspace || '')) {
      return {
        ok: false,
        reason: `that session lives in \`${dir || 'unknown'}\`, but this chat is in \`${workspace || 'unknown'}\` — switch project or pick a session from this workspace.`,
      };
    }
    let msgs = 0;
    let bytes = 0;
    try {
      const agg = db.prepare('select count(*) as n, coalesce(sum(octet_length(data)), 0) as b from session_message where session_id = ?').get(sid);
      msgs = Number(agg?.n || 0);
      bytes = Number(agg?.b || 0);
    } catch { /* size unknown: attachable, unwarned */ }
    return { ok: true, sessionId: sid, title: String(row.title || ''), directory: dir, msgs, bytes };
  } catch {
    return { ok: false, reason: 'the session store query failed — try again in a bit.' };
  } finally {
    try { db.close(); } catch { /* read-only handle */ }
  }
}

export function orphanStorePath({ home = os.homedir() } = {}) {
  return path.join(home, '.hermes', 'session-orphans.json');
}

function readOrphans(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) return parsed.filter((r) => r && typeof r.sessionId === 'string');
    return [];
  } catch {
    return [];
  }
}

/** Register an abandoned id. First record wins; never throws. */
export function recordOrphan({ sessionId = '', workspace = '', reason = '', home = os.homedir(), now = Date.now() } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const file = orphanStorePath({ home });
  const rows = readOrphans(file);
  const hit = rows.find((r) => r.sessionId === sid);
  if (hit) return hit;
  const row = {
    sessionId: sid, workspace: String(workspace || ''), reason: String(reason || ''),
    since: new Date(Number(now)).toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify([...rows, row], null, 2)}\n`, 'utf8');
  } catch {
    return null;
  }
  return row;
}

/** Drop an id (rebound via /attach or a later turn). Returns true when removed. */
export function unorphan({ sessionId = '', home = os.homedir() } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  const file = orphanStorePath({ home });
  const rows = readOrphans(file);
  if (!rows.some((r) => r.sessionId === sid)) return false;
  try {
    fs.writeFileSync(file, `${JSON.stringify(rows.filter((r) => r.sessionId !== sid), null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function listOrphans({ home = os.homedir() } = {}) {
  return readOrphans(orphanStorePath({ home }));
}

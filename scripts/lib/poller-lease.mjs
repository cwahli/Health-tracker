/**
 * Guard 10: one live poller per bot id.
 *
 * Moving a bot to another machine creates the dangerous overlap — the old
 * host still polling while the new one starts. Both would answer the same
 * chat on the same allowance. A lease, checked against a live pid, refuses
 * the second one by name.
 *
 * The move itself is: drain (the old poller stops claiming work), release
 * (its lease goes), start the new one (it acquires). A lease whose pid is
 * dead is not held — a crash must not fence the next boot.
 *
 * Store: ~/.hermes/poller-lease/<botId>.json
 *   { key, host, pid, acquiredAt, renewedAt, takenOverFrom }
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function leasePath(key, home = os.homedir()) {
  const safe = String(key || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
  return path.join(home, '.hermes', 'poller-lease', `${safe}.json`);
}

function alive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    // EPERM means the pid exists but belongs to someone else — still alive.
    return err?.code === 'EPERM';
  }
}

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function write(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
}

export function pollerLeaseState({ key, home = os.homedir() } = {}) {
  return read(leasePath(key, home));
}

/**
 * Take the lease, or be told exactly who holds it. A lease held by a dead
 * pid is taken over rather than refused: a crash must not fence the next boot.
 */
export function acquirePollerLease({ key, host = '', pid = process.pid, home = os.homedir(), now = Date.now() } = {}) {
  const file = leasePath(key, home);
  const current = read(file);
  const mine = Number(pid) || 0;
  if (current && current.pid && current.pid !== mine && alive(current.pid)) {
    return {
      ok: false,
      owner: current,
      reason: `poller already running for ${key} (pid ${current.pid} on ${current.host || 'unknown host'} since ${current.acquiredAt})`,
    };
  }
  const row = {
    key: String(key || ''),
    host: String(host || current?.host || ''),
    pid: mine,
    acquiredAt: current?.acquiredAt || new Date(now).toISOString(),
    renewedAt: new Date(now).toISOString(),
    takenOverFrom: current?.pid && current.pid !== mine ? { host: current.host, pid: current.pid } : null,
  };
  write(file, row);
  return { ok: true, row, reason: current ? `took over from pid ${current.pid}` : 'acquired' };
}

/** Heartbeat: the holder acknowledges it is still the holder. */
export function renewPollerLease({ key, host = '', pid = process.pid, home = os.homedir(), now = Date.now() } = {}) {
  const file = leasePath(key, home);
  const current = read(file);
  if (!current || current.pid !== Number(pid)) return false;
  if (host) current.host = String(host);
  current.renewedAt = new Date(now).toISOString();
  write(file, current);
  return true;
}

/** Give the lease back — only its holder can, so a stale release is a no-op. */
export function releasePollerLease({ key, pid = process.pid, home = os.homedir() } = {}) {
  const file = leasePath(key, home);
  const current = read(file);
  if (!current || current.pid !== Number(pid)) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

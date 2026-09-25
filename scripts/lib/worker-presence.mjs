/**
 * Which execution hosts a worker has actually connected from.
 *
 * `/location <host>` used to assign process.env.BOT_LOCATION and reply that
 * the location was set. That is a variable, not a connection: the next turn
 * still ran on the VM, and the reply said otherwise. A host counts as
 * reachable only when a worker for it has connected and has been heard from
 * recently. The worker dials outward, so the VM never opens a socket to the
 * phone or the notebook.
 *
 * Store: ~/.hermes/workers/<host>.json
 *   { host, pid, detail, connectedAt, lastSeen }
 * A record is stale (treated as gone) when lastSeen is older than TTL_MS, or
 * when it names a local pid that is no longer alive.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TTL_MS = 2 * 60 * 1000;

/** Hosts this bot knows how to be told about. */
export const KNOWN_HOSTS = ['vps', 'vm2', 'mobile', 'collab', 'grok'];

/** Hosts that run on the machine this process runs on. */
export const LOCAL_HOSTS = ['vps', 'vm2'];

export function workersDir(home = os.homedir()) {
  return path.join(home, '.hermes', 'workers');
}

export function presencePath(host, home = os.homedir()) {
  const safe = String(host || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return path.join(workersDir(home), `${safe || 'unknown'}.json`);
}

export function isLocalHost(host, { home = os.homedir() } = {}) {
  const h = String(host || '').trim().toLowerCase();
  if (LOCAL_HOSTS.includes(h)) return true;
  // A phone poller calls itself mobile; on the box, a root home is the phone.
  return h === 'mobile' && home === '/root';
}

function alive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Called by the relay that accepted a worker's outbound connection. */
export function recordWorkerConnected({ host, pid = null, detail = '', home = os.homedir(), now = Date.now() } = {}) {
  const file = presencePath(host, home);
  const prev = readJson(file) || {};
  const row = {
    host: String(host || '').trim().toLowerCase(),
    pid: pid ?? null,
    detail: String(detail || '').slice(0, 200),
    connectedAt: prev.connectedAt || new Date(now).toISOString(),
    lastSeen: new Date(now).toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  return row;
}

/** Called on every inbound frame from that worker, so the record stays fresh. */
export function touchWorker(host, opts = {}) {
  return recordWorkerConnected(opts.host ? opts : { ...opts, host });
}

export function clearWorker(host, home = os.homedir()) {
  try {
    fs.rmSync(presencePath(host, home), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {{host: string, reachable: boolean, reason: string, lastSeen: string|null, ageMs: number|null}}
 */
export function workerStatus(host, { home = os.homedir(), now = Date.now(), ttlMs = TTL_MS } = {}) {
  const h = String(host || '').trim().toLowerCase();
  if (isLocalHost(h, { home })) {
    return { host: h, reachable: true, reason: 'this machine runs the poller', lastSeen: null, ageMs: 0 };
  }
  const row = readJson(presencePath(h, home));
  if (!row || !row.lastSeen) {
    return { host: h, reachable: false, reason: 'no worker has connected', lastSeen: null, ageMs: null };
  }
  const lastMs = Date.parse(row.lastSeen);
  const ageMs = Number.isFinite(lastMs) ? Math.max(0, now - lastMs) : null;
  if (ageMs === null) {
    return { host: h, reachable: false, reason: 'worker record has no usable timestamp', lastSeen: row.lastSeen, ageMs: null };
  }
  if (ageMs > ttlMs) {
    return { host: h, reachable: false, reason: `worker silent for ${Math.round(ageMs / 1000)}s`, lastSeen: row.lastSeen, ageMs };
  }
  if (row.pid && !alive(row.pid)) {
    return { host: h, reachable: false, reason: `worker pid ${row.pid} is gone`, lastSeen: row.lastSeen, ageMs };
  }
  return { host: h, reachable: true, reason: 'worker connected', lastSeen: row.lastSeen, ageMs };
}

export function isReachable(host, opts = {}) {
  return workerStatus(host, opts).reachable;
}

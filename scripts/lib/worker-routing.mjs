/**
 * Which host a chat's turns run on, and whether that host has proved itself.
 *
 * Flipping a route is a deploy. The first turn on a worker that has not run
 * one yet is a canary: the old path stays live until it passes, a failure
 * rolls the route back, and the conversation the chat already has is never
 * rewritten by a failed canary.
 *
 * Store: ~/.hermes/worker-routing.json
 *   { "<host>": { state, previous, attempts, canary: { jobId, at, ok, reason }, updatedAt } }
 * `state` is `canary` (not yet proven), `active` (proven) or `failed`
 * (rolled back — the next turn is held until the user re-arms it with
 * `/location <host>`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROUTE_STATES = ['canary', 'active', 'failed'];

export function routingPath(home = os.homedir()) {
  return path.join(home, '.hermes', 'worker-routing.json');
}

function readAll(home) {
  try {
    const parsed = JSON.parse(fs.readFileSync(routingPath(home), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(home, data) {
  const file = routingPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function routeFor(host, { home = os.homedir() } = {}) {
  return readAll(home)[String(host || '').toLowerCase()] || null;
}

/** null = never routed to; otherwise the row's state. */
export function routeState(host, opts = {}) {
  return routeFor(host, opts)?.state || null;
}

/**
 * Arm a host for a canary. Called when the user names it (`/location`), so a
 * failed host can be re-armed by naming it again. Keeps the previous host so
 * a failure can roll back to the path that was live before.
 */
export function armRoute(host, { previous = '', home = os.homedir(), now = Date.now() } = {}) {
  const all = readAll(home);
  const key = String(host || '').toLowerCase();
  const prior = all[key] || {};
  all[key] = {
    state: 'canary',
    previous: String(previous || prior.previous || ''),
    attempts: Number(prior.attempts || 0),
    canary: null,
    updatedAt: new Date(now).toISOString(),
  };
  writeAll(home, all);
  return all[key];
}

/** The canary passed: this host is where turns run from now on. */
export function confirmRoute(host, { jobId = '', home = os.homedir(), now = Date.now() } = {}) {
  const all = readAll(home);
  const key = String(host || '').toLowerCase();
  const prior = all[key] || { previous: '', attempts: 0 };
  all[key] = {
    ...prior,
    state: 'active',
    attempts: Number(prior.attempts || 0) + 1,
    canary: { jobId: String(jobId || ''), at: new Date(now).toISOString(), ok: true, reason: '' },
    updatedAt: new Date(now).toISOString(),
  };
  writeAll(home, all);
  return all[key];
}

/** The canary failed: roll back to the previous host, keep the session alone. */
export function rollbackRoute(host, { jobId = '', reason = '', home = os.homedir(), now = Date.now() } = {}) {
  const all = readAll(home);
  const key = String(host || '').toLowerCase();
  const prior = all[key] || { previous: '', attempts: 0 };
  all[key] = {
    ...prior,
    state: 'failed',
    attempts: Number(prior.attempts || 0) + 1,
    canary: { jobId: String(jobId || ''), at: new Date(now).toISOString(), ok: false, reason: String(reason || '') },
    updatedAt: new Date(now).toISOString(),
  };
  writeAll(home, all);
  return all[key];
}

/** A host that has never run a turn, or one still in canary, needs one. */
export function needsCanary(host, opts = {}) {
  const state = routeState(host, opts);
  return state !== 'active';
}

/**
 * What a canary has to come back with: a real answer or an explicit error,
 * the conversation it was asked to continue, a workspace it actually used,
 * and the ledger of the worker that ran it — not this machine's.
 */
export function validateCanaryResult({ host = '', requestedSessionId = '', result = {}, ledgerSuffix = '' } = {}) {
  const reasons = [];
  const text = String(result?.text || '').trim();
  const error = String(result?.error || '').trim();
  if (!text && !error) reasons.push('empty result: no text and no explicit error');

  const gotSession = String(result?.sessionID || '').trim();
  const wantSession = String(requestedSessionId || '').trim();
  if (wantSession && !error) {
    if (!gotSession) reasons.push(`sessionID lost: asked for ${wantSession}, the worker returned none`);
    else if (gotSession !== wantSession) reasons.push(`sessionID mismatch: asked for ${wantSession}, got ${gotSession}`);
  }

  const workspace = String(result?.workspace || '').trim();
  if (!workspace) reasons.push('no workspace reported by the worker');

  const ledger = String(result?.ledger || '').trim();
  const expectedSuffix = ledgerSuffix || `worker-${host}`;
  if (!ledger) reasons.push('no ledger reported: cannot tell who ran it');
  else if (!ledger.includes(expectedSuffix)) reasons.push(`wrong ledger: expected one ending in ${expectedSuffix}, got ${ledger}`);

  return { ok: reasons.length === 0, reasons };
}

/**
 * Preflight and failure policy for a turn handed to another machine.
 *
 * A swap — the chat's location moving to a different host — must never fail
 * into a quiet local run and never into a second guess. These checks run
 * before the job is enqueued, in a fixed order, and every failure comes back
 * named, so the caller can hold the turn instead of running it here.
 *
 * Order (stop at the first failure):
 *   presence  — workerStatus(host) says a worker is connected and fresh
 *   relay     — GET <relay>/health answers
 *   workspace — the project id resolves to a directory that exists
 *   session   — GET <relay>/sessions/<id>/check says the conversation is there
 *
 * Result shape: { ok, failed, reason, checks } where `failed` is one of
 * PREFLIGHT_CHECKS, or null when everything passed.
 *
 * Retry policy (guard 8) lives here too: only timeouts, expired claims and
 * relay blips are retried, on the same job id, with backoff. Bad session ids,
 * missing workspaces, dead workers and depleted lanes are never retried —
 * they are rerouted or stopped.
 */

import fs from 'node:fs';

import { workerStatus, isLocalHost, workerCwd as reportedCwd } from './worker-presence.mjs';
import { workspaceForId } from './project-registry.mjs';

export const PREFLIGHT_CHECKS = ['presence', 'relay', 'workspace', 'session'];

export function relayUrl({ url = '', env = process.env } = {}) {
  return String(url || env.WORKER_RELAY_URL || 'http://127.0.0.1:8890').replace(/\/+$/, '');
}

async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body, error: '' };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: String(err?.message || err) };
  }
}

export function checkPresence(host, { home, now = Date.now() } = {}) {
  const status = workerStatus(host, { home, now });
  if (isLocalHost(host, { home })) {
    return { ok: true, detail: 'this machine runs the poller', local: true };
  }
  return { ok: status.reachable, detail: status.reason, local: false };
}

export async function checkRelay(relay, { fetchImpl = fetch } = {}) {
  const base = relayUrl({ url: relay });
  const health = await fetchJson(`${base}/health`, { fetchImpl });
  const ok = Boolean(health.ok && health.body?.ok === true);
  return { ok, base, detail: ok ? `relay healthy at ${base}` : (health.error || `relay ${base} answered ${health.status || 'nothing'}`) };
}

export function checkWorkspace(projectId, { host = '', workerCwd = '', exists = (p) => { try { return fs.existsSync(p); } catch { return false; } } } = {}) {
  const id = String(projectId || '').trim();
  if (!id) return { ok: false, detail: 'the job carries no workspace id', resolved: null };
  const declared = workspaceForId(id, { host });
  const resolved = [declared, workerCwd].filter(Boolean).find((p) => exists(p)) || null;
  if (resolved) return { ok: true, detail: `${id} -> ${resolved}`, resolved };
  return {
    ok: false,
    detail: `workspaceForId("${id}", host=${host || 'any'}) resolved to nothing that exists here${workerCwd ? ` and the worker's own directory ${workerCwd} is not visible` : ''}`,
    resolved: null,
  };
}

export async function checkSession(sessionId, { relay = '', fetchImpl = fetch } = {}) {
  const id = String(sessionId || '').trim();
  if (!id) return { ok: true, detail: 'fresh conversation, nothing to fetch', skipped: true };
  const base = relayUrl({ url: relay });
  const res = await fetchJson(`${base}/sessions/${encodeURIComponent(id)}/check`, { fetchImpl });
  if (res.error) return { ok: false, detail: `session check unreachable: ${res.error}` };
  if (res.status === 400) return { ok: false, detail: `malformed session id ${id}` };
  if (res.status === 404) return { ok: false, detail: `session ${id} is not on this host` };
  if (res.status === 503) return { ok: false, detail: 'opencode is not available on the relay' };
  if (!res.ok) return { ok: false, detail: `session check answered ${res.status}` };
  const bytes = res.body?.bytes;
  return { ok: true, detail: bytes ? `session ${id} exportable (${bytes} bytes)` : `session ${id} is exportable` };
}

/**
 * Run the checks in order and stop at the first failure.
 * `full:false` skips the session probe (already-active routes do not pay for
 * it on every turn); everything else always runs.
 */
export async function preflightWorkerTurn({
  host,
  workspace = '',
  sessionId = '',
  relay = '',
  workerCwd = '',
  home = undefined,
  now = Date.now(),
  full = true,
  fetchImpl = fetch,
  exists = undefined,
} = {}) {
  const checks = [];
  const fail = (failed, reason) => ({ ok: false, failed, reason, checks });
  const workerDirectory = String(workerCwd || (host ? reportedCwd(host, { home }) : '') || '');

  const presence = checkPresence(host, { home, now });
  checks.push({ name: 'presence', ok: presence.ok, detail: presence.detail });
  if (!presence.ok) return fail('presence', presence.detail);
  if (presence.local) return { ok: true, failed: null, reason: presence.detail, checks };

  const relayCheck = await checkRelay(relay, { fetchImpl });
  checks.push({ name: 'relay', ok: relayCheck.ok, detail: relayCheck.detail });
  if (!relayCheck.ok) return fail('relay', relayCheck.detail);

  const workspaceCheck = checkWorkspace(workspace, { host, workerCwd: workerDirectory, ...(exists ? { exists } : {}) });
  checks.push({ name: 'workspace', ok: workspaceCheck.ok, detail: workspaceCheck.detail });
  if (!workspaceCheck.ok) return fail('workspace', workspaceCheck.detail);

  if (full) {
    const sessionCheck = await checkSession(sessionId, { relay, fetchImpl });
    checks.push({ name: 'session', ok: sessionCheck.ok, detail: sessionCheck.detail });
    if (!sessionCheck.ok) return fail('session', sessionCheck.detail);
  }

  return { ok: true, failed: null, reason: 'preflight passed', checks };
}

export function preflightSummary(checks = []) {
  return checks.map((c) => `${c.ok ? 'ok' : 'FAIL'} ${c.name}: ${c.detail}`).join('; ');
}

/**
 * Named failures only. `retryable` is true for the three transient classes
 * guard 8 allows (timeout, expired claim, relay blip); everything else is
 * stopped or rerouted, never retried.
 */
export function classifyWorkerFailure(text = '') {
  const s = String(text || '');
  if (/workspace_unresolved/i.test(s)) return { retryable: false, code: 'workspace' };
  if (/session (not found|is not)|unknown session|malformed session/i.test(s)) return { retryable: false, code: 'session' };
  if (/no allowance|depleted|quota|lane.*(full|depleted)/i.test(s)) return { retryable: false, code: 'depleted' };
  if (/no worker|worker (pid .* is gone|silent|unreachable)/i.test(s)) return { retryable: false, code: 'worker' };
  if (/claim expired|lease expired|claim .*expired/i.test(s)) return { retryable: true, code: 'transient' };
  if (/did not answer in time|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|network error|EPIPE/i.test(s)) {
    return { retryable: true, code: 'transient' };
  }
  return { retryable: false, code: 'permanent' };
}

export function retryDelayMs(attempt = 1, { baseMs = 1500, capMs = 15000 } = {}) {
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(capMs, baseMs * 2 ** (n - 1));
}

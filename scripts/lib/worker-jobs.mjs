/**
 * Job hand-off between the VM and a worker on another machine.
 *
 * The worker dials outward. The VM never opens a socket to a phone or a
 * notebook, there is no Tailscale hop and no tunnel URL: a worker long-polls
 * this store over the connection it already made, runs the turn on its own
 * machine, and posts the result back.
 *
 * Store: ~/.hermes/worker-jobs/<jobId>.json
 *   { id, host, prompt, model, project, role, workspace, sessionId, createdAt, claimedAt, doneAt, result }
 * `workspace` travels as a project id (health-tracker, external-2), never as a
 * machine path: /home/ubuntu/src/Health-tracker is this machine's checkout and
 * means nothing on the notebook that claims the job. `sessionId` is the
 * conversation to resume — without it the worker starts a blank one and the
 * turn loses its history on the far side.
 * A job is claimed once. A worker that dies holding a claim does not strand the
 * turn: claimLeaseMs decides when the job may be handed to somebody else.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectIdForWorkspace } from './work-session.mjs';

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export function jobsDir(home = os.homedir()) {
  return path.join(home, '.hermes', 'worker-jobs');
}

function jobPath(id, home) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  return path.join(jobsDir(home), `${safe}.json`);
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

function allJobs(home) {
  let names = [];
  try {
    names = fs.readdirSync(jobsDir(home));
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const row = read(path.join(jobsDir(home), name));
    if (row) rows.push(row);
  }
  return rows;
}

export function enqueueJob(job, { home = os.homedir(), now = Date.now() } = {}) {
  const id = `j${now.toString(36)}${Math.floor(Math.random() * 0xffff).toString(16)}`;
  const row = {
    id,
    host: String(job.host || ''),
    prompt: String(job.prompt ?? ''),
    model: String(job.model || ''),
    project: String(job.project || ''),
    role: String(job.role || ''),
    workspace: String(job.workspaceId || projectIdForWorkspace(job.workspace || '')),
    sessionId: String(job.sessionId || ''),
    envMode: String(job.envMode || 'project'),
    canary: Boolean(job.canary),
    packId: String(job.packId || ''),
    attempts: 0,
    createdAt: new Date(now).toISOString(),
    claimedAt: null,
    doneAt: null,
    result: null,
  };
  write(jobPath(id, home), row);
  return row;
}

/**
 * Put an unfinished job back on the queue under the SAME id (guard 8).
 * Only a transient failure earns this: a job that already produced a result is
 * never reopened, and a job that is still claimed is left to its claim — the
 * caller decides that by asking for it after the claim expired.
 */
export function requeueJob(id, { home = os.homedir(), now = Date.now(), reason = '' } = {}) {
  const file = jobPath(id, home);
  if (!file) return null;
  const job = read(file);
  if (!job || job.doneAt) return null;
  job.claimedAt = null;
  job.claimedBy = null;
  job.attempts = Number(job.attempts || 0) + 1;
  job.requeuedAt = new Date(now).toISOString();
  if (reason) job.requeueReason = String(reason);
  write(file, job);
  return job;
}

/** The oldest unclaimed, unexpired job for a host, marked claimed. */
export function claimJob(host, { home = os.homedir(), now = Date.now(), leaseMs = DEFAULT_LEASE_MS } = {}) {
  const wanted = String(host || '').trim().toLowerCase();
  const candidates = allJobs(home)
    .filter((r) => !wanted || String(r.host || '').toLowerCase() === wanted)
    .filter((r) => !r.doneAt)
    .filter((r) => {
      if (!r.claimedAt) return true;
      const age = now - Date.parse(r.claimedAt);
      return Number.isFinite(age) && age > leaseMs;
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const job = candidates[0];
  if (!job) return null;
  job.claimedAt = new Date(now).toISOString();
  job.claimedBy = wanted || 'any';
  write(jobPath(job.id, home), job);
  return job;
}

export function completeJob(id, result, { home = os.homedir(), now = Date.now() } = {}) {
  const file = jobPath(id, home);
  if (!file) return null;
  const job = read(file);
  if (!job) return null;
  job.doneAt = new Date(now).toISOString();
  const machine = result?.machine && typeof result.machine === 'object' ? result.machine : null;
  job.result = {
    text: String(result?.text || ''),
    code: Number(result?.code ?? 0),
    model: String(result?.model || job.model || ''),
    error: String(result?.error || ''),
    ledger: String(result?.ledger || ''),
    // Which machine ran it, so the canary can refuse a job that came from a
    // different machine than presence names. Sanitized to the three fields —
    // the relay never stores anything else the worker posts.
    machine: machine
      ? {
          hostname: String(machine.hostname || '').slice(0, 200),
          platform: String(machine.platform || '').slice(0, 40),
          arch: String(machine.arch || '').slice(0, 40),
        }
      : null,
    // Conversation continuity, back to whoever handed the turn over: the
    // thread the device ran (so the next turn resumes it, here or there),
    // where it was resumed from, and the directory it actually used.
    sessionID: String(result?.sessionID || ''),
    resumedFrom: String(result?.resumedFrom || ''),
    workspace: String(result?.workspace || ''),
    // How many files the worker actually wrote from the pack, so a swap can
    // be judged on what landed, not on the upload that was accepted.
    packApplied: Number(result?.packApplied ?? 0),
  };
  write(file, job);
  return job;
}

export function getJob(id, { home = os.homedir() } = {}) {
  const file = jobPath(id, home);
  return file ? read(file) : null;
}

/** Wait for a job's result. Resolves null on timeout. */
export async function awaitJob(id, { home = os.homedir(), timeoutMs = 600000, pollMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getJob(id, { home });
    if (job?.doneAt) return job;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

export function pendingCount(home = os.homedir()) {
  return allJobs(home).filter((r) => !r.doneAt).length;
}

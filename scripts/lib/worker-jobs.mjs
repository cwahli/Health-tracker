/**
 * Job hand-off between the VM and a worker on another machine.
 *
 * The worker dials outward. The VM never opens a socket to a phone or a
 * notebook, there is no Tailscale hop and no tunnel URL: a worker long-polls
 * this store over the connection it already made, runs the turn on its own
 * machine, and posts the result back.
 *
 * Store: ~/.hermes/worker-jobs/<jobId>.json
 *   { id, host, prompt, model, project, role, workspace, createdAt, claimedAt, doneAt, result }
 * A job is claimed once. A worker that dies holding a claim does not strand the
 * turn: claimLeaseMs decides when the job may be handed to somebody else.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    workspace: String(job.workspace || ''),
    envMode: String(job.envMode || 'project'),
    createdAt: new Date(now).toISOString(),
    claimedAt: null,
    doneAt: null,
    result: null,
  };
  write(jobPath(id, home), row);
  return row;
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
  job.result = {
    text: String(result?.text || ''),
    code: Number(result?.code ?? 0),
    model: String(result?.model || job.model || ''),
    error: String(result?.error || ''),
    ledger: String(result?.ledger || ''),
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

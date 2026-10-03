/**
 * Job hand-off between the VM and a worker on another machine.
 *
 * The worker dials outward. The VM never opens a socket to a phone or a
 * notebook, there is no Tailscale hop and no tunnel URL: a worker long-polls
 * this store over the connection it already made, runs the turn on its own
 * machine, and posts the result back.
 *
 * Store: ~/.hermes/worker-jobs/<jobId>.json
 *   { id, host, prompt, model, project, role, workspace, sessionId, createdAt, claimedAt, doneAt, result,
 *     events, aborted, abortedAt }
 * `workspace` travels as a project id (health-tracker, external-2), never as a
 * machine path: /home/ubuntu/src/Health-tracker is this machine's checkout and
 * means nothing on the notebook that claims the job. `sessionId` is the
 * conversation to resume — without it the worker starts a blank one and the
 * turn loses its history on the far side.
 * A job is claimed once. A worker that dies holding a claim does not strand the
 * turn: claimLeaseMs decides when the job may be handed to somebody else.
 *
 * Live view (TG-native, replaces tmux tail): while the worker runs the turn it
 * POSTs sanitized progress events (tool/thinking/error/step) to the relay via
 * appendJobEvent(). The bot-host polls readJobEvents() while awaiting the
 * result and fans each event out to the TG headline, the verbose watch feed,
 * and the observer log. Events are capped (count + bytes) so a chatty turn
 * cannot grow the job file without bound. `aborted` lets /abort (and the Abort
 * inline button) reach a remote turn: the VM posts /jobs/abort, and the worker
 * — which cannot read this store, it is the VM's — polls the relay's
 * /jobs/<id>/status every couple of seconds and SIGKILLs its opencode child.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectIdForWorkspace } from './work-session.mjs';

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

/** Live-event channel bounds: a chatty turn must not grow the job file. */
export const MAX_JOB_EVENTS = 500;
export const MAX_JOB_EVENT_CHARS = 2000;

/**
 * The event cursor is a **producer-assigned monotonic sequence**, never an
 * index into the stored array.
 *
 * It used to be an index, and the array was trimmed from the front with
 * `shift()` once it passed MAX_JOB_EVENTS. Those two facts together are a
 * silent correctness bug on any turn long enough to overflow the cap: the
 * reader's `after` (an index) silently starts pointing at a *different* event
 * the moment the array shifts, so events are duplicated or skipped with no
 * error anywhere. A chatty turn on a free lane crosses 500 events routinely.
 *
 * With a monotonic `seq` the cap is still a cap, but the reader can now be
 * told the truth: `droppedThrough` names the highest sequence that fell off
 * the back, so a reader whose `after` is older than that knows it has a gap
 * (`resyncRequired`) instead of silently reading the wrong window.
 *
 * The cursor is also assigned by whoever *observes* the model (the producer),
 * so `at` is the producer's clock. The receiver's clock is kept separately as
 * `receivedAt`; across a VM<->phone relay with any clock skew the two order
 * events differently, and conflating them made tmux and Telegram disagree
 * about which thing happened first.
 */

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
    events: [],
    aborted: false,
    abortedAt: null,
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

/**
 * Append one sanitized live event to a claimed job. Only the small,
 * renderable kinds travel (tool/reasoning/text/error/step_finish); anything
 * else is dropped. Returns { ok, seq } where seq is the event index the
 * poller passes back as `after`. Never throws — a full or missing job is a
 * silent no-op so event pressure can never fail the turn itself.
 */
export function appendJobEvent(id, event, { home = os.homedir(), now = Date.now() } = {}) {
  const file = jobPath(id, home);
  if (!file) return { ok: false, reason: 'bad job id' };
  const job = read(file);
  if (!job || job.doneAt) return { ok: false, reason: 'unknown or finished job' };
  const kind = String(event?.kind || '');
  if (!['tool', 'reasoning', 'text', 'error', 'step_finish', 'run_start'].includes(kind)) {
    return { ok: false, reason: `unsupported event kind: ${kind || '(none)'}` };
  }
  const clip = (v, max = MAX_JOB_EVENT_CHARS) => String(v ?? '').slice(0, max);
  // The producer's own timestamp is the truth about ordering. Keep it when it
  // is a usable ISO string, and keep the receiver's clock beside it as
  // `receivedAt` so latency stays measurable instead of being erased.
  const producerAt = typeof event?.at === 'string' && !Number.isNaN(Date.parse(event.at))
    ? event.at
    : null;
  const clean = {
    kind,
    seq: (Number(job.lastEventSeq) || 0) + 1,
    at: producerAt || new Date(now).toISOString(),
    receivedAt: new Date(now).toISOString(),
  };
  if (producerAt) clean.producerAt = true;
  if (event.tool != null) clean.tool = clip(event.tool, 100);
  if (event.status != null) clean.status = clip(event.status, 60);
  if (event.text != null) clean.text = clip(event.text);
  if (event.message != null) clean.message = clip(event.message);
  if (event.input != null) clean.input = clip(typeof event.input === 'string' ? event.input : JSON.stringify(event.input));
  if (event.output != null) clean.output = clip(typeof event.output === 'string' ? event.output : JSON.stringify(event.output));
  if (event.tokens != null && Number.isFinite(Number(event.tokens))) clean.tokens = Number(event.tokens);
  if (!Array.isArray(job.events)) job.events = [];
  job.events.push(clean);
  job.lastEventSeq = clean.seq;
  // Trim from the front, but remember *what* went so a reader can be told it
  // has a gap. `droppedThrough` is a sequence, so it stays meaningful after the
  // array it described is gone.
  while (job.events.length > MAX_JOB_EVENTS) {
    const dropped = job.events.shift();
    job.droppedThrough = Number(dropped?.seq) || Number(job.droppedThrough) || 0;
  }
  write(file, job);
  return { ok: true, seq: clean.seq };
}

/**
 * Read events appended after index `after` (0-based count). Returns
 * { events, nextAfter, done, aborted } so the poller fans out only what is
 * new and stops when the job is done or aborted.
 */
export function readJobEvents(id, { after = 0, home = os.homedir() } = {}) {
  const job = getJob(id, { home });
  if (!job) return { events: [], nextAfter: Number(after) || 0, done: false, aborted: false, resyncRequired: false, droppedThrough: 0 };
  const events = Array.isArray(job.events) ? job.events : [];
  const from = Math.max(0, Number(after) || 0);
  const droppedThrough = Number(job.droppedThrough) || 0;

  // A job written before this change has index-addressed events and no `seq`.
  // Reading those by sequence would silently skip the whole backlog, so an
  // unsequenced backlog falls back to the old index slice. New jobs always
  // have `seq` on every event and take the correct path below.
  const sequenced = events.length > 0 && events.every((e) => Number.isFinite(Number(e?.seq)));
  if (!sequenced) {
    return {
      events: events.slice(from),
      nextAfter: events.length,
      done: Boolean(job.doneAt),
      aborted: Boolean(job.aborted),
      resyncRequired: false,
      droppedThrough: 0,
      unsequenced: true,
    };
  }

  // Select by sequence, not position. `after` is the highest sequence the
  // caller has already seen; anything strictly greater is new to it.
  const fresh = events.filter((e) => Number(e.seq) > from);
  const highest = fresh.length ? Number(fresh[fresh.length - 1].seq) : from;
  // The caller is behind the trim point: events between its cursor and the
  // oldest retained one no longer exist anywhere. Say so rather than handing
  // back a window that looks complete but is not.
  const resyncRequired = droppedThrough > 0 && from < droppedThrough;
  return {
    events: fresh,
    nextAfter: Math.max(highest, from),
    done: Boolean(job.doneAt),
    aborted: Boolean(job.aborted),
    resyncRequired,
    droppedThrough,
  };
}

/** Flag a claimed job as aborted. The worker polls this and kills its child. */
export function abortJob(id, { home = os.homedir(), now = Date.now() } = {}) {
  const file = jobPath(id, home);
  if (!file) return null;
  const job = read(file);
  if (!job || job.doneAt) return null;
  job.aborted = true;
  job.abortedAt = new Date(now).toISOString();
  write(file, job);
  return job;
}

export function isJobAborted(id, { home = os.homedir() } = {}) {
  return Boolean(getJob(id, { home })?.aborted);
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

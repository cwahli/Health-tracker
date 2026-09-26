#!/usr/bin/env node
/**
 * Worker agent: the device end of the location hand-off.
 *
 * Run this on the phone or the notebook. It dials the VM, registers itself as a
 * connected worker, and then long-polls for turns. The VM opens nothing inbound
 * to this machine.
 *
 *   node scripts/worker-agent.mjs --host=mobile --relay=https://<vm-host>/relay
 *
 * It keeps its own free-lane ledger, so a turn that runs here spends THIS
 * machine's allowance and stamps THIS machine's ledger. The VM never writes it.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runOpencode } from './lib/agent-opencode.mjs';
import { runCline } from './lib/agent-cline.mjs';
import { buildChildEnv } from './lib/child-env.mjs';
import { ensureBotLedger, stampDepleted, isConnectionFailure, freemodelRefToRoute } from './lib/free-lanes.mjs';
import { isQuotaOrLimitError } from './lib/agent-opencode.mjs';
import { workspaceForId } from './lib/project-registry.mjs';
import { applyPack } from './lib/swap-pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const HOST = arg('host', process.env.WORKER_HOST || 'mobile');
const RELAY = arg('relay', process.env.WORKER_RELAY_URL || 'http://127.0.0.1:8890');
const DETAIL = arg('detail', `${os.hostname()} ${os.platform()}`);
const LEDGER = ensureBotLedger(`worker-${HOST}`);

function log(...parts) {
  console.log(`[worker:${HOST}]`, ...parts);
}

async function post(route, body) {
  const res = await fetch(`${RELAY}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: HOST, pid: process.pid, detail: DETAIL, cwd: process.cwd(), ...body }),
  });
  return res.json().catch(() => ({}));
}

async function register() {
  const out = await post('/connect', {});
  log('registered with the relay:', out.ok ? 'ok' : JSON.stringify(out));
  return out.ok === true;
}

/** This machine's own ledger is the only one this worker writes. */
function stampHere(modelRef, result) {
  const text = String(result?.finalText || '').trim();
  if (text) return null;
  const err = String(result?.lastError || result?.stderr || '');
  if (!err) return null;
  if (!isQuotaOrLimitError(err) && !isConnectionFailure(err)) return null;
  const { provider, model } = freemodelRefToRoute(modelRef || '');
  if (!provider || !model) return null;
  const stamped = stampDepleted({ stateDir: LEDGER.dir, provider, model, errText: err });
  if (stamped.stamped) log(`stamped my own ledger: ${stamped.keys.join(', ')}`);
  return stamped;
}

function opencodeBin() {
  return process.env.OPENCODE_BIN || 'opencode';
}

function runOpencodeCli(args, { timeoutMs = 60000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(opencodeBin(), args, { timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') });
    });
  });
}

/** Does this machine already have that conversation? */
async function sessionIsHere(sessionId) {
  const { ok, out } = await runOpencodeCli(['session', 'list'], { maxBuffer: 32 * 1024 * 1024 });
  return ok && out.split('\n').some((line) => line.includes(sessionId));
}

/**
 * Pull the conversation from the VM. `opencode export` on the relay produces
 * the JSON, and `opencode import` here rebinds it to THIS machine's checkout —
 * that rebinding is why the job carries a session id and a workspace id, and
 * not a path from the machine that started it.
 */
async function importSessionFromRelay(sessionId) {
  let res;
  try {
    res = await fetch(`${RELAY}/sessions/${encodeURIComponent(sessionId)}/export`);
  } catch (err) {
    log(`relay unreachable for ${sessionId}:`, String(err?.message || err).slice(0, 120));
    return false;
  }
  if (!res.ok) return false;
  const body = await res.text();
  if (!body.trim().startsWith('{')) return false;
  const tmp = path.join(os.tmpdir(), `session-${process.pid}-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmp, body);
  } catch {
    return false;
  }
  const { ok } = await runOpencodeCli(['import', tmp]);
  try {
    fs.unlinkSync(tmp);
  } catch {
    // leave nothing behind if the unlink fails
  }
  return ok;
}

/**
 * Resume the conversation the job names, or start a fresh one and say so.
 * Failing closed here would be worse than running blank: a turn that cannot
 * find its history still has to answer. What must not happen is a *quiet*
 * wrong history, so the log says which of the three happened.
 */
async function resumeSession(sessionId) {
  if (!sessionId) return { sessionId: '', resumed: false, from: 'none' };
  if (await sessionIsHere(sessionId)) return { sessionId, resumed: true, from: 'local' };
  if (await importSessionFromRelay(sessionId)) return { sessionId, resumed: true, from: 'relay' };
  log(`session ${sessionId} is not here and the relay had no export — running a fresh conversation`);
  return { sessionId: '', resumed: false, from: 'missing' };
}

/**
 * Guard 9: fetch the sender's changed files and write them into this
 * workspace — every file re-hashed against the manifest first, a path that
 * would leave the workspace refused, and nothing applied if any file is off.
 * A pack that cannot be fetched is reported, not fatal: the turn still runs.
 */
async function applyJobPack(packId, workspace) {
  try {
    const res = await fetch(`${RELAY}/packs/${encodeURIComponent(packId)}`);
    if (res.status === 404) return { ok: false, reason: 'pack is not on the relay' };
    if (!res.ok) return { ok: false, reason: `relay answered ${res.status}` };
    const payload = await res.json();
    return applyPack(workspace, payload);
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

async function runJob(job) {
  const { model, prompt, envMode } = job;
  // Guard 4: a project id that resolves to nothing here is a named failure,
  // not a quiet run in this worker's own directory — the whole point of the
  // job carrying an id instead of a path is that the path is this machine's.
  const workspace = workspaceForId(job.workspace, { host: HOST });
  if (!workspace) {
    const error = `workspace_unresolved: no directory for project "${job.workspace}" on ${HOST}`;
    log(`${job.id} refused: ${error}`);
    return {
      jobId: job.id,
      text: '',
      code: 1,
      model: model || '',
      error,
      ledger: LEDGER.dir,
      sessionID: '',
      resumedFrom: '',
      workspace: '',
    };
  }
  let packApplied = 0;
  if (job.packId) {
    const applied = await applyJobPack(job.packId, workspace);
    if (applied.ok) {
      packApplied = applied.applied.length;
      log(`pack ${job.packId}: ${applied.reason}`);
    } else {
      log(`pack ${job.packId} refused: ${applied.reason}`);
    }
  }
  const env = buildChildEnv({ mode: envMode || 'project' });
  const resume = await resumeSession(job.sessionId);
  log(`running ${job.id} on ${model || 'default'} in ${workspace}${resume.sessionId ? ` (session ${resume.sessionId} via ${resume.from})` : ''}`);
  try {
    const result = String(model || '').startsWith('cline:')
      ? await runCline({ prompt, model: model.slice('cline:'.length), workspace, env, envMode })
      : await runOpencode({ prompt, model, workspace, env, envMode, sessionId: resume.sessionId, timeoutMs: 900000 });
    stampHere(model, result);
    return {
      jobId: job.id,
      text: String(result?.finalText || ''),
      code: Number(result?.code ?? 0),
      model,
      error: String(result?.lastError || '').slice(0, 400),
      ledger: LEDGER.dir,
      // Back to the VM so the next turn on any host resumes the same thread.
      sessionID: String(result?.sessionID || resume.sessionId || ''),
      resumedFrom: resume.from,
      workspace,
      packApplied,
    };
  } catch (err) {
    log(`job ${job.id} failed:`, String(err?.stack || err?.message || err).slice(0, 500));
    return {
      jobId: job.id,
      text: '',
      code: 1,
      model,
      error: String(err?.message || err).slice(0, 400),
      ledger: LEDGER.dir,
      sessionID: String(resume.sessionId || ''),
      resumedFrom: resume.from,
      workspace,
      packApplied,
    };
  }
}

async function loop() {
  const ok = await register();
  if (!ok) {
    log('could not register; is the relay reachable?');
    process.exitCode = 1;
    return;
  }
  const beat = setInterval(() => { post('/heartbeat', {}).catch(() => {}); }, 30000);
  for (;;) {
    try {
      const res = await fetch(`${RELAY}/jobs/next?host=${encodeURIComponent(HOST)}&wait=25000`);
      if (res.status === 204) continue;
      const { job } = await res.json();
      if (!job) continue;
      const out = await runJob(job);
      await post('/jobs/result', out);
      log(`${job.id} delivered ${out.text ? out.text.slice(0, 80) : 'no text'}`);
    } catch (err) {
      log('poll failed:', String(err?.message || err).slice(0, 120));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  clearInterval(beat);
}

loop();

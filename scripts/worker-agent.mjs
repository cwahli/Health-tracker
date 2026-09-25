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
import { fileURLToPath } from 'node:url';
import { runOpencode } from './lib/agent-opencode.mjs';
import { runCline } from './lib/agent-cline.mjs';
import { buildChildEnv } from './lib/child-env.mjs';
import { ensureBotLedger, stampDepleted, isConnectionFailure, freemodelRefToRoute } from './lib/free-lanes.mjs';
import { isQuotaOrLimitError } from './lib/agent-opencode.mjs';

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
    body: JSON.stringify({ host: HOST, pid: process.pid, detail: DETAIL, ...body }),
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

async function runJob(job) {
  const { model, prompt, workspace, envMode } = job;
  const env = buildChildEnv({ mode: envMode || 'project' });
  log(`running ${job.id} on ${model || 'default'} in ${workspace || HERE}`);
  try {
    const result = String(model || '').startsWith('cline:')
      ? await runCline({ prompt, model: model.slice('cline:'.length), workspace: workspace || HERE, env, envMode })
      : await runOpencode({ prompt, model, workspace: workspace || HERE, env, envMode, timeoutMs: 900000 });
    stampHere(model, result);
    return {
      jobId: job.id,
      text: String(result?.finalText || ''),
      code: Number(result?.code ?? 0),
      model,
      error: String(result?.lastError || '').slice(0, 400),
      ledger: LEDGER.dir,
    };
  } catch (err) {
    return { jobId: job.id, text: '', code: 1, model, error: String(err?.message || err).slice(0, 400), ledger: LEDGER.dir };
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

#!/usr/bin/env node
/**
 * assert-relay-auth.test.mjs — direct-route relay auth gate.
 *
 * The relay holds session exports and pack contents, so a publicly reachable
 * relay must never serve anonymously. Proves, with a real relay and (for the
 * round trip) a real worker-agent process:
 *  1. without a token, a relay behaves exactly as before (all routes open);
 *  2. with WORKER_RELAY_TOKEN set, every route except GET /health answers 401
 *     without it and works with `Authorization: Bearer <token>`;
 *  3. a worker started with the token registers, heartbeats, claims a job and
 *     posts the result back — the full loop, authenticated;
 *  4. swap-guards sends the token on the session check and names a 401 as an
 *     auth failure (never retried, never silent).
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('assert-relay-auth\n');

const TOKEN = 'drill-token-abc123';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-auth-'));
const port = 8930 + Math.floor(Math.random() * 50);
const base = `http://127.0.0.1:${port}`;
const auth = { authorization: `Bearer ${TOKEN}` };

async function startRelay(extraEnv = {}) {
  const proc = spawn(process.execPath, [path.join(HERE, 'worker-relay.mjs'), `--port=${port}`], {
    env: { ...process.env, HOME: home, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return proc;
    } catch { await sleep(150); }
  }
  try { proc.kill('SIGKILL'); } catch {}
  return null;
}
const stop = (p) => { try { p.kill('SIGKILL'); } catch {} };

try {
  // 1. No token: the old loopback behavior is unchanged.
  let relay = await startRelay();
  check('a tokenless relay starts', Boolean(relay));
  if (relay) {
    const reg = await (await fetch(`${base}/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: 'plain', pid: 1 }),
    })).json().catch(() => ({}));
    check('a tokenless relay still accepts a worker', reg.ok === true);
    stop(relay);
    await sleep(300);
  }

  // 2. Token set: everything but /health is 401 without it.
  relay = await startRelay({ WORKER_RELAY_TOKEN: TOKEN });
  check('a token relay starts', Boolean(relay));
  if (!relay) throw new Error('token relay did not start');
  const health = await fetch(`${base}/health`);
  check('GET /health stays open for monitoring', health.ok === true);
  const anon = await Promise.all([
    fetch(`${base}/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status),
    fetch(`${base}/jobs/next?host=h&wait=0`).then((r) => r.status),
    fetch(`${base}/jobs/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status),
    fetch(`${base}/sessions/ses_abc123/export`).then((r) => r.status),
    fetch(`${base}/sessions/ses_abc123/check`).then((r) => r.status),
    fetch(`${base}/packs/p1`).then((r) => r.status),
    fetch(`${base}/packs/p1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status),
  ]);
  check('anonymous callers get 401 on every guarded route', anon.every((s) => s === 401), anon.join(','));
  const wrong = await fetch(`${base}/connect`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
    body: JSON.stringify({ host: 'x' }),
  });
  check('a wrong token is also 401 (timing-safe compare)', wrong.status === 401);
  const authed = await (await fetch(`${base}/connect`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ host: 'authed', pid: 1 }),
  })).json().catch(() => ({}));
  check('the right bearer token registers', authed.ok === true);

  // 3. Full loop with a real worker-agent started with the token. The host must
  // be a known one: /health only reports KNOWN_HOSTS.
  const device = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-auth-device-'));
  const worker = spawn(process.execPath, [path.join(HERE, 'worker-agent.mjs'), '--host=mobile', `--relay=${base}`], {
    env: { ...process.env, HOME: device, WORKER_RELAY_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  try {
    let seen = false;
    for (let i = 0; i < 40 && !seen; i++) {
      const h = await (await fetch(`${base}/health`)).json().catch(() => null);
      seen = h?.workers?.some((w) => w.host === 'mobile' && w.reachable);
      if (!seen) await sleep(500);
    }
    check('a token-started worker registers through the guarded relay', seen);
    if (seen) {
      const { enqueueJob, getJob } = await import('./lib/worker-jobs.mjs');
      const job = enqueueJob(
        { host: 'mobile', prompt: 'say ok', model: 'opencode/definitely-not-a-model', workspace: 'health-tracker', sessionId: '', envMode: 'project' },
        { home },
      );
      let done = null;
      for (let i = 0; i < 90 && !done; i++) {
        const row = getJob(job.id, { home });
        if (row?.doneAt) { done = row; break; }
        await sleep(1000);
      }
      check('the authed worker claimed and answered the job', Boolean(done?.doneAt));
      check('its result names its own ledger', /worker-mobile/.test(String(done?.result?.ledger || '')));
    }
  } finally {
    stop(worker);
    fs.rmSync(device, { recursive: true, force: true });
  }
  stop(relay);

  // 4. Swap-guards threading: the header goes out, a 401 names auth failure.
  const guards = await import(path.join(HERE, 'lib', 'swap-guards.mjs'));
  let sawHeaders = null;
  await guards.checkSession('ses_probe01', {
    relay: 'http://127.0.0.1:9',
    fetchImpl: async (url, opts) => { sawHeaders = opts?.headers || null; throw new Error('down'); },
    token: 'tok123',
  });
  check('the session check sends the bearer token',
    sawHeaders?.authorization === 'Bearer tok123', JSON.stringify(sawHeaders));
  const refused = await guards.checkSession('ses_probe01', {
    relay: base,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    token: 'tok123',
  });
  check('a 401 becomes a named auth failure, never a retryable blip',
    refused.ok === false && /token/.test(refused.detail)
    && guards.classifyWorkerFailure('relay 401: bad token').code === 'auth'
    && guards.classifyWorkerFailure('relay 401: bad token').retryable === false);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}

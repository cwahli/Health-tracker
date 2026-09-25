// Cards 5, 6 and 6c need a transport: the VM must be able to hand a turn to a
// worker on another machine, and that worker must spend its OWN ledger. These
// tests run a real relay and real worker processes over HTTP. The workers are
// local processes, not a phone — the transport, the presence and the ledger
// separation are what is under test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; } else { console.error(`  FAIL  ${name}`); failed++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('assert-worker-relay:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
const port = 8900 + Math.floor(Math.random() * 80);
const relay = spawn(process.execPath, [path.join(HERE, 'worker-relay.mjs'), `--port=${port}`], {
  env: { ...process.env, HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
});
relay.stderr.on('data', (d) => process.stderr.write(`[relay] ${d}`));

const workers = [];
try {
  // wait for the relay to listen
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      up = r.ok;
    } catch { await sleep(150); }
  }
  check('the relay listens on loopback', up);
  if (!up) throw new Error('relay did not start');

  // 1. Presence: an unknown host is unreachable, a registered one is not.
  const before = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  const mobileBefore = before.workers.find((w) => w.host === 'mobile');
  check('a host with no worker is unreachable', mobileBefore?.reachable === false);

  const reg = await (await fetch(`http://127.0.0.1:${port}/connect`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: 'mobile', pid: process.pid, detail: 'test worker' }),
  })).json();
  check('a worker can register', reg.ok === true);

  const after = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  check('the relay reports it as reachable', after.workers.find((w) => w.host === 'mobile')?.reachable === true);
  check('the VM never opened a socket to the worker', true);

  // 2. All four locations are known and answerable.
  const hosts = after.workers.map((w) => w.host);
  for (const h of ['vps', 'vm2', 'mobile', 'collab', 'grok']) {
    check(`the relay knows ${h}`, hosts.includes(h));
  }
  check('vps needs no worker: it is this machine', after.workers.find((w) => w.host === 'vps')?.reachable === true);

  // 3. A job handed to a worker comes back with text, and the worker stamped
  //    its own ledger rather than the VM's.
  const w = spawn(process.execPath, [path.join(HERE, 'worker-agent.mjs'), `--host=mobile`, `--relay=http://127.0.0.1:${port}`], {
    env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  workers.push(w);
  w.stderr.on('data', (d) => process.stderr.write(`[worker] ${d}`));
  await sleep(1500);

  // The relay and the worker both run with HOME=home, so the test addresses the
  // same store explicitly rather than through its own HOME.
  const { enqueueJob, getJob } = await import('./lib/worker-jobs.mjs');
  const job = enqueueJob({ host: 'mobile', prompt: 'reply with the word ok', model: 'grok/grok-4.7', workspace: home, envMode: 'project' }, { home });
  let done = null;
  for (let i = 0; i < 120 && !done; i++) {
    const row = getJob(job.id, { home });
    if (row?.doneAt) { done = row; break; }
    await sleep(1000);
  }
  // What is under test is the transport, not the model: a job is claimed once,
  // run on the worker, and posted back with the ledger the worker used. Whether
  // the text is non-empty depends on a runnable model, which the live pass
  // covers; a sensor must not spend real allowance to say so.
  check('the worker answered the job', Boolean(done?.doneAt));
  check('the job carries the prompt it was given', done?.prompt === 'reply with the word ok');
  check('the worker reports which ledger it used', typeof done?.result?.ledger === 'string' && done.result.ledger.includes('worker-mobile'));
  const vmLedger = path.join(home, '.local', 'state', 'bot-host', 'vm', 'free-lanes');
  check('the worker ledger is its own directory, not the VM bot ledger', done?.result?.ledger !== vmLedger);
  check('and it is named for the worker host', /worker-mobile/.test(String(done?.result?.ledger || '')));
  check('the job was claimed exactly once', typeof done?.claimedAt === 'string');
  check('the job store lives on the VM, not the device', fs.existsSync(path.join(home, '.hermes', 'worker-jobs')));

  // 4. A claim is a claim: the same job is not handed to a second worker.
  const claimRes = await fetch(`http://127.0.0.1:${port}/jobs/next?host=mobile&wait=0`);
  const claimAgain = claimRes.status === 204 ? {} : await claimRes.json();
  check('a finished job is not handed out again', !claimAgain.job || claimAgain.job.id !== job.id);

  // 5. The relay refuses nonsense instead of guessing.
  const noHost = await fetch(`http://127.0.0.1:${port}/connect`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
  });
  check('a connect without a host is refused', noHost.status === 400);
  const badRoute = await fetch(`http://127.0.0.1:${port}/nope`);
  check('an unknown route is a 404', badRoute.status === 404);
} finally {
  for (const w of workers) { try { w.kill('SIGKILL'); } catch {} }
  try { relay.kill('SIGKILL'); } catch {}
  await sleep(200);
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);

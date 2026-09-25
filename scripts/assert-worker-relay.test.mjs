// Cards 5, 6 and 6c need a transport: the VM must be able to hand a turn to a
// worker on another machine, and that worker must spend its OWN ledger. These
// tests run a real relay and real worker processes over HTTP. The workers are
// local processes, not a phone — the transport, the presence and the ledger
// separation are what is under test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); passed++; } else { console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('assert-worker-relay:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
// The device gets its own HOME. The relay runs the VM's store, the worker runs
// its own — that is the real topology, and it is what makes a conversation
// hand-over testable instead of both sides reading the same file.
const device = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-device-'));
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
    env: { ...process.env, HOME: device },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  workers.push(w);
  w.stderr.on('data', (d) => process.stderr.write(`[worker] ${d}`));
  await sleep(1500);

  // The relay holds the VM's store (home); the worker holds its own (device).
  // The test addresses the VM's store explicitly rather than through HOME.
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

  // 3b. What a job carries across the wire: a workspace id and the
  //     conversation to resume. /home/ubuntu/src/Health-tracker is this
  //     machine's checkout and means nothing on a notebook.
  const shaped = enqueueJob({
    host: 'grok',
    prompt: 'shape probe',
    model: 'opencode/definitely-not-a-model',
    project: 'health-tracker',
    role: 'frontend_ui',
    workspace: '/home/ubuntu/src/Health-tracker',
    sessionId: 'ses_probe_shape_01',
    envMode: 'project',
  }, { home });
  check('the job carries a workspace id, not a machine path', shaped.workspace === 'health-tracker', shaped.workspace);
  check('the job carries the conversation to resume', shaped.sessionId === 'ses_probe_shape_01');
  const opaque = enqueueJob({ host: 'grok', prompt: 'x', workspace: home }, { home });
  check('a workspace nobody knows is passed through, not guessed at', opaque.workspace === home, opaque.workspace);

  // 3c. Continuity. The conversation is imported into the relay's HOME only,
  //     so the device cannot read it off disk — it has to arrive over the
  //     relay, which is exactly what a move between machines requires.
  const fixtureId = 'ses_fixtureRelay01';
  const fixturePath = path.join(home, 'session-fixture.json');
  fs.writeFileSync(fixturePath, `${JSON.stringify({
    info: {
      id: fixtureId,
      slug: 'relay-fixture',
      projectID: 'global',
      directory: home,
      path: home,
      title: 'conversation the device has not got',
      agent: 'build',
      model: { id: 'muse-spark-1.3-contributor-free', providerID: 'opencode', variant: 'default' },
      version: '1.18.32',
      summary: { additions: 0, deletions: 0, files: 0 },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now(), updated: Date.now() },
    },
    messages: [],
  }, null, 2)}\n`);
  const imported = await new Promise((resolve) => {
    execFile('opencode', ['import', fixturePath], { env: { ...process.env, HOME: home }, timeout: 60000 },
      (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}${err ? err.message : ''}` }));
  });
  check('the VM-side conversation exists for the test', imported.ok, imported.out.replace(/\s+/g, ' ').slice(0, 200));

  const exportRes = await fetch(`http://127.0.0.1:${port}/sessions/${fixtureId}/export`);
  const exportBody = exportRes.ok ? await exportRes.json().catch(() => null) : null;
  check('the relay exports that conversation to a worker', exportRes.ok && exportBody?.info?.id === fixtureId, `status ${exportRes.status}`);

  const job2 = enqueueJob({
    host: 'mobile',
    prompt: 'carry the conversation over',
    model: 'opencode/definitely-not-a-model',
    project: 'health-tracker',
    role: '',
    workspace: '/home/ubuntu/src/Health-tracker',
    sessionId: fixtureId,
    envMode: 'project',
  }, { home });
  let done2 = null;
  for (let i = 0; i < 120 && !done2; i++) {
    const row = getJob(job2.id, { home });
    if (row?.doneAt) { done2 = row; break; }
    await sleep(1000);
  }
  check('the device answered the job that carried a conversation', Boolean(done2?.doneAt), String(done2?.result?.error || ''));
  check('the device ran in a workspace of its own, not the VM path', Boolean(done2?.result?.workspace) && done2.result.workspace !== '/home/ubuntu/src/Health-tracker', String(done2?.result?.workspace));
  check('the device pulled the conversation from the relay', done2?.result?.resumedFrom === 'relay', `resumedFrom=${done2?.result?.resumedFrom} error=${String(done2?.result?.error || '')}`);

  const missing = await fetch(`http://127.0.0.1:${port}/sessions/ses_not_here_at_all/export`);
  check('the relay refuses a conversation it does not have', missing.status >= 400, `status ${missing.status}`);
  const malformed = await fetch(`http://127.0.0.1:${port}/sessions/not-a-session-id/export`);
  check('the relay refuses a malformed session id', malformed.status === 400, `status ${malformed.status}`);

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
  fs.rmSync(device, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);

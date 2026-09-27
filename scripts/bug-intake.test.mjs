/**
 * scripts/bug-intake.test.mjs
 *
 * The drainer's contract. The one that matters most is the negative: a row that
 * was not sent must survive. A drainer that deletes what it failed to deliver
 * would silently eat a filed bug report, and nothing else in the repo would
 * notice — the bug simply never existed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import http from 'node:http';
import {
  OP_ROUTES,
  assertOpTableMatches,
  planDrain,
  queueBody,
  readQueueLines,
  writeQueueLines,
} from './lib/bug-intake.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DRAIN = path.join(REPO_ROOT, 'scripts', 'bugctl-drain.mjs');

const row = (op, extra = {}) => JSON.stringify({ op, queued_at: '2026-01-01T00:00:00.000Z', ...extra });

test('routes every write op bugctl can queue', () => {
  for (const op of ['create', 'pack', 'defect', 'repro', 'plan', 'attempt', 'verify', 'close',
    'claim', 'duplicate', 'unblock', 'block', 'evidence', 'curate', 'handoff']) {
    assert.equal(typeof OP_ROUTES[op], 'function', `missing route for ${op}`);
  }
});

test('strips only the bookkeeping fields bugctl adds', () => {
  assert.deepEqual(queueBody({ op: 'create', queued_at: 'x', title: 'T' }), { title: 'T' });
  // op itself is routing, not payload.
  assert.equal('op' in queueBody({ op: 'create', queued_at: 'x' }), false);
});

test('a card create replays to POST /api/bugs with no id needed', () => {
  const { send, keep } = planDrain([row('create', { title: 'Phone bug' })]);
  assert.equal(keep.length, 0);
  assert.equal(send.length, 1);
  assert.equal(send[0].method, 'POST');
  assert.equal(send[0].path, '/api/bugs');
  assert.equal(send[0].body.title, 'Phone bug');
});

test('a screenshot create keeps its image through the queue', () => {
  const dataUrl = 'data:image/png;base64,AAAA';
  const { send } = planDrain([row('create', { title: 'With picture', screenshot: dataUrl })]);
  assert.equal(send[0].body.screenshot, dataUrl);
});

test('an id-bearing op encodes the id and sends only the fields bugctl sends', () => {
  const { send } = planDrain([row('block', { id: '#7', reason: 'x', extra: 'ignored' })]);
  // '#' must be percent-encoded, or it reads as a fragment and the id is lost.
  assert.equal(send[0].path, '/api/bugs/%237');
  assert.equal(send[0].method, 'PATCH');
  // block sends exactly the two fields bugctl's own flush sends.
  assert.deepEqual(send[0].body, { blocked_reason: 'x', queue: 'blocked' });
});

test('an unparseable line is kept, never dropped', () => {
  const { send, keep, corrupt } = planDrain(['{not json', row('create', { title: 'ok' })]);
  assert.equal(corrupt, 1);
  assert.equal(send.length, 1);
  assert.deepEqual(keep, ['{not json']);
});

test('an op with no route is kept rather than silently discarded', () => {
  const line = row('some_future_op', { id: 1 });
  const { send, keep } = planDrain([line]);
  assert.equal(send.length, 0);
  assert.deepEqual(keep, [line]);
});

test('op table drift fails loudly instead of replaying to the wrong route', () => {
  assert.equal(assertOpTableMatches(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bugctl.mjs'), 'utf8')), true);
  assert.throws(() => assertOpTableMatches('// nothing here'), /no longer handles/);
});

test('queue round-trips, and an empty queue removes the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-'));
  const q = path.join(dir, 'q.jsonl');
  assert.deepEqual(readQueueLines(q), []);
  writeQueueLines(q, ['a', 'b']);
  assert.deepEqual(readQueueLines(q), ['a', 'b']);
  writeQueueLines(q, []);
  assert.equal(fs.existsSync(q), false);
});

function runDrain(env, extraArgs = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [DRAIN, '--json', ...extraArgs], { env: { ...process.env, ...env }, timeout: 20000 },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

function closedPort() {
  const srv = net.createServer();
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
    const port = srv.address().port;
    srv.close(() => resolve(port));
  }));
}

test('drain exits 0 and reports empty when there is no queue', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-'));
  const r = await runDrain({ BUGCTL_QUEUE: path.join(dir, 'none.jsonl') });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).remaining, 0);
});

test('drain replays what the server accepts and empties the queue', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-'));
  const q = path.join(dir, 'q.jsonl');
  fs.writeFileSync(q, [row('create', { title: 'Queued phone bug' }), row('create', { title: 'Second' })].join('\n') + '\n');
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { seen.push({ url: req.url, body: b }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const r = await runDrain({ BUGCTL_QUEUE: q, BUG_API_BASE: `http://127.0.0.1:${port}` });
  srv.close();
  assert.equal(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.sent, 2);
  assert.equal(report.remaining, 0);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, '/api/bugs');
  assert.equal(fs.existsSync(q), false);
});

test('a row the server REJECTS stays in the queue and the exit code is 1', async () => {
  // The load-bearing negative test: a rejected write must not vanish.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-'));
  const q = path.join(dir, 'q.jsonl');
  const good = row('create', { title: 'Accepted' });
  const bad = row('create', { title: 'Rejected' });
  fs.writeFileSync(q, [good, bad].join('\n') + '\n');
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      if (b.includes('Rejected')) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"nope"}'); }
      else { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const r = await runDrain({ BUGCTL_QUEUE: q, BUG_API_BASE: `http://127.0.0.1:${port}` });
  srv.close();
  assert.equal(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.sent, 1);
  assert.equal(report.remaining, 1);
  const left = readQueueLines(q);
  assert.equal(left.length, 1);
  assert.ok(left[0].includes('Rejected'), 'the rejected row must be the one that survives');
});

test('an unreachable API leaves every row queued', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-'));
  const q = path.join(dir, 'q.jsonl');
  fs.writeFileSync(q, row('create', { title: 'Still waiting' }) + '\n');
  const r = await runDrain({ BUGCTL_QUEUE: q, BUG_API_BASE: `http://127.0.0.1:${await closedPort()}` });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).remaining, 1);
  assert.equal(readQueueLines(q).length, 1);
});

test('--limit leaves the untouched remainder queued', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-'));
  const q = path.join(dir, 'q.jsonl');
  fs.writeFileSync(q, [row('create', { title: 'a' }), row('create', { title: 'b' }), row('create', { title: 'c' })].join('\n') + '\n');
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const r = await runDrain({ BUGCTL_QUEUE: q, BUG_API_BASE: `http://127.0.0.1:${port}` }, ['--limit=2']);
  srv.close();
  const report = JSON.parse(r.stdout);
  assert.equal(report.sent, 2);
  assert.equal(report.remaining, 1);
  assert.equal(readQueueLines(q).length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wakeEnabled, triagePrompt, notifyTodoEvent, routeFor, retryBackoffSec } from './todo-notify.mjs';

const tmpState = () => fs.mkdtempSync(path.join(os.tmpdir(), 'todo-notify-'));

test('wake is off by default (gateway suite can never spawn)', () => {
  const r = wakeEnabled({}, { exists: () => false });
  assert.equal(r.ok, false);
});

test('killswitch disables even when env is on', () => {
  const r = wakeEnabled({ TODO_AGENT_NOTIFY: '1' }, { exists: (p) => p.endsWith('DISABLED') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /killswitch/);
});

test('enabled only with flag on and no killswitch', () => {
  const r = wakeEnabled({ TODO_AGENT_NOTIFY: '1' }, { exists: () => false });
  assert.equal(r.ok, true);
});

test('bad action or missing key is refused before any side effect', () => {
  const calls = [];
  const r1 = notifyTodoEvent('nuke', 'k', {}, {
    exists: () => false, mkdir: () => {}, append: (l) => calls.push(l), spawnFn: () => calls.push('SPAWN'),
  });
  assert.equal(r1.ok, false);
  const r2 = notifyTodoEvent('approve', '', {}, {
    exists: () => false, mkdir: () => {}, append: (l) => calls.push(l), spawnFn: () => calls.push('SPAWN'),
  });
  assert.equal(r2.ok, false);
  assert.deepEqual(calls, []);
});

test('disabled gate still records the inbox line, spawns nothing', () => {
  const inbox = [];
  let spawned = 0;
  const r = notifyTodoEvent('comment', 'card:tag_x', {}, {
    exists: () => false, mkdir: () => {}, append: (l) => inbox.push(l), spawnFn: () => { spawned += 1; },
  });
  assert.equal(r.ok, false);
  assert.equal(spawned, 0);
  assert.equal(inbox.length, 1);
  const line = JSON.parse(inbox[0]);
  assert.equal(line.type, 'review_comment');
  assert.equal(line.key, 'card:tag_x');
  assert.equal(line.source, 'gateway-hook');
});

test('enabled gate spawns one detached triage run with a read-only prompt', () => {
  const dir = tmpState();
  const inboxPath = path.join(dir, 'inbox.jsonl');
  const receipts = [];
  let argv = null;
  let opts = null;
  const fakeChild = { unref: () => {} };
  const r = notifyTodoEvent('approve', 'card:tag_y', { TODO_AGENT_NOTIFY: '1', HOME: dir }, {
    exists: () => false,
    mkdir: () => {},
    append: (l) => fs.appendFileSync(inboxPath, l + '\n'),
    openLog: () => 'ignore',
    receiptSink: (rec) => receipts.push(rec),
    spawnFn: (cmd, args, o) => { argv = [cmd, ...args]; opts = o; return fakeChild; },
  });
  assert.equal(r.ok, true);
  assert.equal(argv[0], 'flock');
  assert.ok(argv.includes('opencode') && argv.includes('run') && argv.includes('--auto'));
  const prompt = argv[argv.length - 1];
  assert.match(prompt, /TRIAGE ONLY/);
  assert.match(prompt, /no fixes, no writes, no commits, no messages/);
  assert.match(prompt, /card:tag_y/);
  assert.equal(opts.detached, true);
  assert.ok(String(opts.env.PATH).includes('.local/bin'));
  const recorded = JSON.parse(fs.readFileSync(inboxPath, 'utf8').trim());
  assert.equal(recorded.type, 'review_approve');
  assert.deepEqual(receipts.map((x) => x.outcome), ['spawned']);
  assert.equal(receipts[0].route, 'opencode');
  assert.equal(receipts[0].key, 'card:tag_y');
});

const harness = (env = { TODO_AGENT_NOTIFY: '1' }) => {
  const inbox = [];
  const receipts = [];
  const spawns = [];
  let queue = [];
  return {
    inbox, receipts, spawns,
    deps: {
      exists: () => false,
      mkdir: () => {},
      append: (l) => inbox.push(l),
      openLog: () => 'ignore',
      receiptSink: (r) => receipts.push(r),
      readRetry: () => queue.map((e) => ({ ...e })),
      writeRetry: (entries) => { queue = entries.map((e) => ({ ...e })); },
      now: () => 1_000_000,
      spawnFn: (cmd, args, o) => { spawns.push([cmd, ...args]); return { unref: () => {} }; },
    },
    queue: (entries) => { queue = entries.map((e) => ({ ...e })); },
    queued: () => queue.map((e) => ({ ...e })),
    env,
  };
};

test('route defaults to opencode (the starter route)', () => {
  assert.equal(routeFor({}).ok, true);
  assert.equal(routeFor({}).name, 'opencode');
  assert.equal(routeFor({ TODO_TRIAGE_ROUTE: '  ' }).name, 'opencode');
  assert.equal(routeFor({ TODO_TRIAGE_ROUTE: 'log' }).name, 'log');
});

test('unknown route fails closed with a receipt, spawns nothing', () => {
  const h = harness();
  const r = notifyTodoEvent('comment', 'card:tag_z', { TODO_AGENT_NOTIFY: '1', TODO_TRIAGE_ROUTE: 'telegram' }, h.deps);
  assert.equal(r.ok, false);
  assert.equal(h.spawns.length, 0);
  assert.equal(h.inbox.length, 1);
  assert.equal(h.receipts.length, 1);
  assert.equal(h.receipts[0].outcome, 'unknown_route');
  assert.equal(h.receipts[0].key, 'card:tag_z');
});

test('log route records without spawning', () => {
  const h = harness();
  const r = notifyTodoEvent('approve', 'card:tag_q', { TODO_AGENT_NOTIFY: '1', TODO_TRIAGE_ROUTE: 'log' }, h.deps);
  assert.equal(r.ok, true);
  assert.equal(h.spawns.length, 0);
  assert.equal(h.inbox.length, 1);
  assert.deepEqual(h.receipts.map((x) => x.outcome), ['record_only']);
});

test('spawn throw writes spawn_error receipt and enqueues one retry', () => {
  const h = harness();
  h.deps.spawnFn = () => { throw new Error('rate limited'); };
  const r = notifyTodoEvent('comment', 'card:tag_r', h.env, h.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(h.receipts.map((x) => x.outcome), ['spawn_error', 'retry_queued']);
  const q = h.queued();
  assert.equal(q.length, 1);
  assert.equal(q[0].key, 'card:tag_r');
  assert.equal(q[0].tries, 1);
  assert.ok(Number(q[0].notBefore) > 1_000_000);
});

test('a later event drains one due retry and clears it on success', () => {
  const h = harness();
  h.queue([{ action: 'review_comment', key: 'card:tag_d', tries: 1, notBefore: 999_999 }]);
  const r = notifyTodoEvent('approve', 'card:tag_new', h.env, h.deps);
  assert.equal(r.ok, true);
  assert.equal(h.spawns.length, 2);
  assert.deepEqual(h.receipts.map((x) => x.outcome), ['spawned', 'spawned', 'retry_ok']);
  assert.deepEqual(h.queued(), []);
});

test('drain requeues with growing backoff and drops after five tries', () => {
  const h = harness();
  h.deps.spawnFn = () => { throw new Error('down'); };
  h.queue([{ action: 'review_comment', key: 'card:tag_b', tries: 1, notBefore: 1 }]);
  const r = notifyTodoEvent('approve', 'card:tag_new', h.env, h.deps);
  assert.equal(r.ok, true);
  const q = h.queued();
  assert.equal(q.filter((e) => e.key === 'card:tag_b')[0].tries, 2);
  assert.ok(h.receipts.some((x) => x.outcome === 'retry_requeued'));
  h.queue([{ action: 'review_comment', key: 'card:tag_b', tries: 5, notBefore: 1 }]);
  h.receipts.length = 0;
  notifyTodoEvent('approve', 'card:tag_new2', h.env, h.deps);
  assert.deepEqual(h.queued().filter((e) => e.key === 'card:tag_b'), []);
  assert.ok(h.receipts.some((x) => x.outcome === 'retry_exhausted'));
});

test('backoff grows then caps', () => {
  assert.equal(retryBackoffSec(1), 60);
  assert.equal(retryBackoffSec(3), 180);
  assert.equal(retryBackoffSec(99), 900);
});

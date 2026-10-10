import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wakeEnabled, triagePrompt, notifyTodoEvent, notifyTodoText, todoStatusText } from './todo-notify.mjs';

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
  let argv = null;
  let opts = null;
  const fakeChild = { unref: () => {} };
  const r = notifyTodoEvent('approve', 'card:tag_y', { TODO_AGENT_NOTIFY: '1', HOME: dir }, {
    exists: () => false,
    mkdir: () => {},
    append: (l) => fs.appendFileSync(inboxPath, l + '\n'),
    openLog: () => 'ignore',
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
});

test('chat todo files free text and spawns with the message in the prompt', () => {
  const dir = tmpState();
  const inboxPath = path.join(dir, 'inbox.jsonl');
  let prompt = '';
  const r = notifyTodoText('card #3 still shows new after packing', { TODO_AGENT_NOTIFY: '1' }, {
    exists: () => false,
    mkdir: () => {},
    append: (l) => fs.appendFileSync(inboxPath, l + '\n'),
    openLog: () => 'ignore',
    spawnFn: (cmd, args) => { prompt = args[args.length - 1]; return { unref: () => {} }; },
  });
  assert.equal(r.ok, true);
  assert.match(prompt, /TRIAGE ONLY/);
  assert.match(prompt, /card #3 still shows new/);
  const recorded = JSON.parse(fs.readFileSync(inboxPath, 'utf8').trim());
  assert.equal(recorded.type, 'chat_todo');
  assert.equal(recorded.source, 'todo-chat');
});

test('empty or oversized chat todos are refused with nothing recorded', () => {
  const lines = [];
  assert.equal(notifyTodoText('   ', {}, { append: (l) => lines.push(l) }).ok, false);
  assert.equal(notifyTodoText('x'.repeat(2001), {}, { append: (l) => lines.push(l) }).ok, false);
  assert.deepEqual(lines, []);
});

test('todo status renders inbox lines plus the last triage verdict', () => {
  assert.match(todoStatusText([], []), /empty/);
  const out = todoStatusText(
    ['{"at":"t1","type":"chat_todo","key":"fix the thing"}', 'not-json{{{'],
    ['{"at":"t2","needs_go":true,"reason":"pack missing"}'],
  );
  assert.match(out, /chat_todo/);
  assert.match(out, /NEEDS-GO \(pack missing\)/);
});

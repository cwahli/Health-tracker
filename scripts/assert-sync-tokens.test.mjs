/**
 * assert-sync-tokens.test.mjs — sensor for door-token sync in sync-bot-tokens.mjs.
 *
 * A gate nobody has seen fire proves nothing, so this file drives the REAL
 * script (`node scripts/sync-bot-tokens.mjs`) against fixture dirs: a scratch
 * config dir, a scratch master tokens file, and a minimal registry. No live
 * file is touched — hermes rows use a profile name that cannot exist, so that
 * branch always takes its no-env-file skip.
 *
 * What it proves: every bot WITH a master token gains TUI_BOT_TOKEN_<UPPERID>
 * in tui-gateway.env (the board-door set); bots without tokens and
 * device-owned bots gain nothing; --check writes nothing; reruns are
 * byte-identical.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'sync-bot-tokens.mjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-tokens-'));
  const reg = {
    master: 'vm',
    bots: [
      { id: 'vm', name: 'VM Bot', runtime: 'bot-host', enabled: true, telegram: { tokenEnv: 'VM_BOT_TOKEN' }, agent: { kind: 'opencode' } },
      { id: 'qa_meal', name: 'QA', runtime: 'hermes', enabled: true, telegram: { tokenEnv: 'QA_TOKEN' }, hermes: { profile: 'no_such_profile_xyz' }, agent: { kind: 'hermes' } },
      { id: 'mobile', name: 'Mobile', runtime: 'device', enabled: true, telegram: { tokenEnv: 'MOBILE_BOT_TOKEN' }, agent: { kind: 'opencode' } },
      { id: 'ghost', name: 'Ghost', runtime: 'bot-host', enabled: false, telegram: { tokenEnv: 'GHOST_TOKEN' }, agent: { kind: 'opencode' } },
    ],
  };
  const regPath = path.join(dir, 'registry.json');
  fs.writeFileSync(regPath, JSON.stringify(reg));
  const tokensPath = path.join(dir, 'tokens.env');
  fs.writeFileSync(tokensPath, 'VM_BOT_TOKEN=111:aaa\nQA_TOKEN=222:bbb\nMOBILE_BOT_TOKEN=333:ccc\n');
  const cfgDir = path.join(dir, 'cfg');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'tui-gateway.env'), '# door env\nTUI_GATEWAY_PORT=8897\n');
  return { dir, regPath, tokensPath, cfgDir };
}

function run(args, env = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(res.status, 0, `sync failed: ${res.stderr}\n${res.stdout}`);
  return res.stdout;
}

function doorEnv(cfgDir) {
  const out = {};
  for (const line of fs.readFileSync(path.join(cfgDir, 'tui-gateway.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

test('bots with tokens gain door keys; others gain nothing', () => {
  const { regPath, tokensPath, cfgDir } = fixture();
  run([`--registry=${regPath}`, `--tokens=${tokensPath}`, `--dir=${cfgDir}`]);
  const door = doorEnv(cfgDir);
  assert.equal(door.TUI_BOT_TOKEN_VM, '111:aaa');
  assert.equal(door.TUI_BOT_TOKEN_QA_MEAL, '222:bbb');
  assert.ok(!('TUI_BOT_TOKEN_MOBILE' in door), 'device-owned bot must not gain a door key');
  assert.ok(!('TUI_BOT_TOKEN_GHOST' in door), 'bot without master token must not gain a door key');
  assert.equal(door.TUI_GATEWAY_PORT, '8897', 'unrelated keys preserved');
});

test('rerun is byte-identical (no duplicate lines)', () => {
  const { regPath, tokensPath, cfgDir } = fixture();
  const args = [`--registry=${regPath}`, `--tokens=${tokensPath}`, `--dir=${cfgDir}`];
  run(args);
  const once = fs.readFileSync(path.join(cfgDir, 'tui-gateway.env'), 'utf8');
  const out = run(args);
  const twice = fs.readFileSync(path.join(cfgDir, 'tui-gateway.env'), 'utf8');
  assert.equal(twice, once);
  assert.equal(once.split('\n').filter((l) => l.startsWith('TUI_BOT_TOKEN_VM=')).length, 1);
  assert.match(out, /Done:/);
});

test('--check writes nothing', () => {
  const { regPath, tokensPath, cfgDir } = fixture();
  const before = fs.readFileSync(path.join(cfgDir, 'tui-gateway.env'), 'utf8');
  const out = run([`--registry=${regPath}`, `--tokens=${tokensPath}`, `--dir=${cfgDir}`, '--check']);
  const after = fs.readFileSync(path.join(cfgDir, 'tui-gateway.env'), 'utf8');
  assert.equal(after, before);
  assert.match(out, /would gain\/update door token/);
});

test('existing bot-host env keeps hand-added keys (no clobber)', () => {
  const { regPath, tokensPath, cfgDir } = fixture();
  fs.writeFileSync(path.join(cfgDir, 'vm.env'), 'VM_BOT_TOKEN=old\nTUI_GATEWAY_URL=https://example.test\n');
  run([`--registry=${regPath}`, `--tokens=${tokensPath}`, `--dir=${cfgDir}`]);
  const text = fs.readFileSync(path.join(cfgDir, 'vm.env'), 'utf8');
  assert.match(text, /^VM_BOT_TOKEN=111:aaa$/m);
  assert.match(text, /^TUI_GATEWAY_URL=https:\/\/example\.test$/m);
});

test('existing door key value is updated when the master token rotates', () => {
  const { regPath, tokensPath, cfgDir } = fixture();
  const args = [`--registry=${regPath}`, `--tokens=${tokensPath}`, `--dir=${cfgDir}`];
  run(args);
  fs.writeFileSync(tokensPath, 'VM_BOT_TOKEN=999:rotated\nQA_TOKEN=222:bbb\nMOBILE_BOT_TOKEN=333:ccc\n');
  run(args);
  assert.equal(doorEnv(cfgDir).TUI_BOT_TOKEN_VM, '999:rotated');
});

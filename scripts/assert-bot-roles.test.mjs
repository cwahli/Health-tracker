/**
 * assert-bot-roles.test.mjs — the sensor for bot-identity `/role` assignment.
 *
 * A gate nobody has seen fire proves nothing, so this file drives the REAL
 * surface two ways:
 *
 *  1. Pure: the bot-roles.mjs helpers (resolve/validate/apply/describe) plus
 *     the real bots/roles.json catalog — every role valid, patch keys bounded,
 *     filesystem targets present on this host.
 *  2. End to end: `node scripts/bot-host.mjs --simulate="/role …"` against a
 *     fixture registry (generic probe bot + copied catalog). Assign accountant
 *     → the fixture row gains the workspace/skills and stays thin; verifier →
 *     model set; general → overrides cleared; unknown name → falls through to
 *     the project persona path (NOT a bot assignment). BOT_ROLE_NO_RESTART=1
 *     skips the reboot; the registry write is the thing under test.
 *
 * Usage: node scripts/assert-bot-roles.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const FIX = '/tmp/opencode/rolefix';

const {
  ROLE_PATCH_KEYS,
  loadRoles,
  resolveRole,
  applyRoleToRow,
  describeRoleChange,
  validateRoleShape,
  validateRoleTarget,
} = await import('./lib/bot-roles.mjs');

function runSimulate(botId, command, registryPath) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['scripts/bot-host.mjs', `--simulate=${command}`, `--id=${botId}`, `--registry=${registryPath}`],
      { cwd: ROOT, env: { ...process.env, BOT_ROLE_NO_RESTART: '1' }, timeout: 90000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`simulate ${command} failed: ${err.message}\n${stdout}\n${stderr}`));
        else resolve(String(stdout));
      },
    );
  });
}

await test('role lookup is case-insensitive and unknown names miss', () => {
  const catalog = loadRoles(path.join(ROOT, 'bots', 'roles.json'));
  assert.equal(resolveRole(catalog, 'accountant').id, 'accountant');
  assert.equal(resolveRole(catalog, 'VERIFIER').id, 'verifier');
  assert.equal(resolveRole(catalog, ' General ').id, 'general');
  assert.equal(resolveRole(catalog, 'legal'), null);
  assert.equal(resolveRole(catalog, ''), null);
});

await test('real catalog: every role valid, patch keys bounded, targets exist', () => {
  const catalog = loadRoles(path.join(ROOT, 'bots', 'roles.json'));
  const ids = Object.keys(catalog);
  assert.ok(ids.includes('accountant') && ids.includes('verifier') && ids.includes('general'));
  for (const [id, role] of Object.entries(catalog)) {
    assert.deepEqual(validateRoleShape(id, role), [], `role "${id}" shape`);
    const target = validateRoleTarget(role);
    assert.equal(target.ok, true, `role "${id}" target: ${target.reason || 'ok'}`);
  }
});

await test('applyRoleToRow sets, clears, templates, and never mutates input', () => {
  const catalog = loadRoles(path.join(ROOT, 'bots', 'roles.json'));
  const row = { id: 'vm9', extends: 'vm', agent: { playwrightOutputDir: '/tmp/x-vm9', model: 'old-model' } };
  const acc = applyRoleToRow(row, catalog.accountant, 'vm9');
  assert.equal(acc.agent.workspace, '/home/ubuntu/chiwah-tax');
  assert.deepEqual(acc.agent.skills, ['.agents/skills/tax-sweep']);
  assert.ok(!('model' in acc.agent), 'accountant clears the model override');
  assert.equal(acc.agent.playwrightOutputDir, '/tmp/x-vm9', 'untouched leaves survive');
  assert.equal(row.agent.model, 'old-model', 'input row not mutated');
  const ver = applyRoleToRow(acc, catalog.verifier, 'vm9');
  assert.equal(ver.agent.model, 'opencode/muse-spark-1.3-contributor');
  const gen = applyRoleToRow(ver, catalog.general, 'vm9');
  assert.ok(!('workspace' in gen.agent) && !('skills' in gen.agent) && !('model' in gen.agent));
  const changes = describeRoleChange(row, catalog.accountant, 'vm9');
  assert.ok(changes.some((l) => l.includes('agent.workspace') && l.includes('(inherited)')));
});

await test('validateRoleTarget refuses missing workspace and skill packs', () => {
  const catalog = loadRoles(path.join(ROOT, 'bots', 'roles.json'));
  const noWs = validateRoleTarget(catalog.accountant, { stat: () => false });
  assert.equal(noWs.ok, false);
  assert.match(noWs.reason, /workspace/);
  let calls = 0;
  const oneMissing = validateRoleTarget(catalog.accountant, {
    stat: (p) => { calls += 1; return !String(p).includes('tax-sweep'); },
  });
  assert.equal(oneMissing.ok, false);
  assert.match(oneMissing.reason, /tax-sweep/);
  assert.ok(calls >= 2);
});

await test('forbidden patch keys are refused before anything is written', () => {
  const evil = {
    label: 'Evil', blurb: 'touches fleet policy',
    set: { 'telegram.tokenEnv': 'X' }, clear: [],
  };
  const failures = validateRoleShape('evil', evil);
  assert.ok(failures.some((f) => f.includes('telegram.tokenEnv')));
});

await test('E2E: /role accountant rewires a generic forge clone (thin row kept)', async () => {
  fs.rmSync(FIX, { recursive: true, force: true });
  fs.mkdirSync(FIX, { recursive: true });
  const regPath = path.join(FIX, 'registry.json');
  fs.writeFileSync(
    regPath,
    `${JSON.stringify({
      master: 'vm',
      bots: [
        {
          id: 'vm', name: 'VM', runtime: 'bot-host', enabled: true,
          telegram: { tokenEnv: 'VM_BOT_TOKEN', allowedUserIds: [4242] },
          agent: { kind: 'opencode', workspace: '/tmp', playwrightOutputDir: '/tmp/x-vm' },
        },
        {
          id: 'roleprobe', name: 'Probe', runtime: 'bot-host', enabled: true, extends: 'vm',
          telegram: { tokenEnv: 'ROLEPROBE_BOT_TOKEN' },
          agent: { playwrightOutputDir: '/tmp/x-roleprobe' },
        },
      ],
    }, null, 2)}\n`,
  );
  fs.copyFileSync(path.join(ROOT, 'bots', 'roles.json'), path.join(FIX, 'roles.json'));

  const out = await runSimulate('roleprobe', '/role accountant', regPath);
  assert.match(out, /Role assigned: Tax Accountant/);
  assert.match(out, /agent\.workspace/);
  const row = JSON.parse(fs.readFileSync(regPath, 'utf8')).bots.find((b) => b.id === 'roleprobe');
  assert.equal(row.agent.workspace, '/home/ubuntu/chiwah-tax');
  assert.deepEqual(row.agent.skills, ['.agents/skills/tax-sweep']);
  assert.ok(!('kind' in row.agent), 'row stays thin: no inherited leaves materialized');
  assert.equal(row.extends, 'vm');

  const out2 = await runSimulate('roleprobe', '/role verifier', regPath);
  assert.match(out2, /Role assigned: Tax Verifier/);
  const row2 = JSON.parse(fs.readFileSync(regPath, 'utf8')).bots.find((b) => b.id === 'roleprobe');
  assert.equal(row2.agent.model, 'opencode/muse-spark-1.3-contributor');

  const out3 = await runSimulate('roleprobe', '/role general', regPath);
  assert.match(out3, /Role assigned: General/);
  const row3 = JSON.parse(fs.readFileSync(regPath, 'utf8')).bots.find((b) => b.id === 'roleprobe');
  assert.ok(!('workspace' in (row3.agent || {})) && !('skills' in (row3.agent || {})));
});

await test('E2E: unknown role falls through to project personas; bare /role lists bot roles', async () => {
  const regPath = path.join(FIX, 'registry.json');
  const out = await runSimulate('roleprobe', '/role legal', regPath);
  assert.doesNotMatch(out, /Role assigned/);
  const bare = await runSimulate('roleprobe', '/role', regPath);
  assert.match(bare, /Bot Identity Roles/);
  assert.match(bare, /\/role accountant/);
  assert.match(bare, /\/role verifier/);
});

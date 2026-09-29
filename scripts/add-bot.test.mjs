import test from 'node:test';
import assert from 'node:assert/strict';

import { buildThinRow, disallowedKeys, planAddBot, tokenEnvFor, validateId } from './add-bot.mjs';

/**
 * Sensor for the thin-row scaffolder.
 *
 * The point of these rows is that they declare almost nothing, so most of what
 * can go wrong is a row that declares too much or a plan that writes when it
 * should refuse. Both are cheap to drive here and expensive to discover on a
 * live host.
 */

function registry(over = {}) {
  return {
    master: 'vm',
    bots: [
      {
        id: 'vm',
        name: 'VM Bot',
        runtime: 'bot-host',
        enabled: true,
        telegram: { tokenEnv: 'VM_BOT_TOKEN', allowedUserIds: [1] },
        agent: { kind: 'opencode', model: 'opencode/one', sharedSkills: ['a'] },
        progress: { mode: 'concise', maxChars: 220 },
        session: { mode: 'per-chat' },
      },
    ],
    ...over,
  };
}

const plan = (over = {}) => planAddBot({ registry: registry(), id: 'vm3', name: 'VM3 Bot', ...over });

// --- identity --------------------------------------------------------------

test('a lowercase place name is accepted', () => {
  assert.equal(validateId('vm3'), '');
  assert.equal(validateId('bot_42'), '');
});

test('an id that names a model or contains junk is rejected', () => {
  assert.notEqual(validateId('VM3'), '');
  assert.notEqual(validateId('3vm'), '');
  assert.notEqual(validateId('vm 3'), '');
  assert.notEqual(validateId(''), '');
});

test('the token env name is derived by the fleet convention', () => {
  assert.equal(tokenEnvFor('vm3'), 'VM3_BOT_TOKEN');
  assert.equal(tokenEnvFor('my_bot'), 'MY_BOT_BOT_TOKEN');
});

// --- the row ---------------------------------------------------------------

test('the scaffolded row is thin: identity, token, and the clone source', () => {
  const row = buildThinRow({ id: 'vm3', name: 'VM3 Bot', tokenEnv: 'VM3_BOT_TOKEN', extendsId: 'vm' });
  assert.equal(row.id, 'vm3');
  assert.equal(row.extends, 'vm');
  assert.equal(row.runtime, 'bot-host');
  assert.equal(row.enabled, false, 'a new bot stays dark until one live reply proves it');
  assert.deepEqual(row.telegram, { tokenEnv: 'VM3_BOT_TOKEN' });
  assert.equal(row.agent, undefined, 'no agent block: the master supplies it');
  assert.equal(row.progress, undefined, 'flood control is fleet policy');
  assert.equal(row.session, undefined);
});

test('a per-bot screenshot dir is the only allowed agent key', () => {
  const row = buildThinRow({ id: 'vm3', name: 'VM3 Bot', tokenEnv: 'T', extendsId: 'vm', playwrightOutputDir: '/tmp/x' });
  assert.deepEqual(row.agent, { playwrightOutputDir: '/tmp/x' });
  assert.deepEqual(disallowedKeys(row), []);
});

test('a row that restates an inherited surface is refused by the builder check', () => {
  const fat = { ...buildThinRow({ id: 'vm3', name: 'X', tokenEnv: 'T', extendsId: 'vm' }), progress: { maxChars: 1 } };
  assert.deepEqual(disallowedKeys(fat), ['progress.maxChars']);
});

// --- planning --------------------------------------------------------------

test('a valid request plans a row that resolves into a clone', () => {
  const p = plan();
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.row.extends, 'vm');
  assert.equal(p.row.telegram.tokenEnv, 'VM3_BOT_TOKEN');
  assert.equal(p.next.bots.length, 2);
});

test('an explicit --extends parent is honoured', () => {
  const reg = registry();
  reg.bots.push({ id: 'other', name: 'Other', runtime: 'bot-host', enabled: true, extends: 'vm', telegram: { tokenEnv: 'OTHER_TOKEN' } });
  const p = planAddBot({ registry: reg, id: 'vm4', name: 'VM4', extendsId: 'other' });
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.row.extends, 'other');
});

test('a duplicate id is refused', () => {
  const p = plan({ id: 'vm' });
  assert.equal(p.ok, false);
  assert.match(p.reason, /already in the registry/);
});

test('a duplicate tokenEnv is refused — one token is one poller', () => {
  const p = plan({ tokenEnv: 'VM_BOT_TOKEN' });
  assert.equal(p.ok, false);
  assert.match(p.reason, /already used/);
});

test('a missing name is refused', () => {
  const p = plan({ name: '' });
  assert.equal(p.ok, false);
  assert.match(p.reason, /--name/);
});

test('an unknown --extends parent is refused', () => {
  const p = plan({ extendsId: 'ghost' });
  assert.equal(p.ok, false);
  assert.match(p.reason, /not a registry bot/);
});

test('a registry with no master is refused, not written', () => {
  const p = planAddBot({ registry: { bots: [] }, id: 'vm3', name: 'VM3' });
  assert.equal(p.ok, false);
  assert.match(p.reason, /master/);
});

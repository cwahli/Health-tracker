// Sensor for scripts/tui-bot-plumbing.mjs: the uniform shape holds on
// fixtures, and drift (stale tree, port mismatch, missing token) fails.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unitFor, caddyFor, envFor, checkBot, tmuxNameFor, CANONICAL_TREE } from './tui-bot-plumbing.mjs';

const goodUnit = unitFor('vm9', { port: 8901, route: '/tty9/' });
const goodEnv = {
  TUI_BOT_TOKEN_VM9: 'tok',
  TUI_TTYD_URL_VM9: 'http://127.0.0.1:8901',
  TUI_ROUTE_VM9_PATH: '/tty9/',
};
const goodCaddy = caddyFor('vm9', { port: 8901, route: '/tty9/' });
const readers = (over = {}) => ({
  readUnit: () => goodUnit,
  unitActive: () => true,
  readCaddy: () => goodCaddy,
  gatewayEnv: { ...goodEnv },
  ...over,
});

describe('tui-bot-plumbing', () => {
  it('canonical names: vm keeps VM-tui, others append', () => {
    assert.equal(tmuxNameFor('vm'), 'VM-tui');
    assert.equal(tmuxNameFor('vm9'), 'VM-tui-vm9');
  });

  it('a canonical bot passes every check', () => {
    const r = checkBot('vm9', readers());
    assert.equal(r.ok, true, JSON.stringify(r.items));
  });

  it('a unit on a stale tree fails unitTree', () => {
    const stale = goodUnit.replaceAll(CANONICAL_TREE, '/home/ubuntu/bot-host');
    const r = checkBot('vm9', readers({ readUnit: () => stale }));
    assert.equal(r.ok, false);
    assert.equal(r.items.unitTree, false);
  });

  it('a unit/env port mismatch fails portsMatch', () => {
    const env = { ...goodEnv, TUI_TTYD_URL_VM9: 'http://127.0.0.1:8999' };
    const r = checkBot('vm9', readers({ gatewayEnv: env }));
    assert.equal(r.ok, false);
    assert.equal(r.items.portsMatch, false);
  });

  it('a missing door token fails token', () => {
    const env = { ...goodEnv };
    delete env.TUI_BOT_TOKEN_VM9;
    const r = checkBot('vm9', readers({ gatewayEnv: env }));
    assert.equal(r.ok, false);
    assert.equal(r.items.token, false);
  });

  it('gateway-default routes cover vm/vm2 without env rows', () => {
    const r = checkBot('vm', readers({ gatewayEnv: { TUI_BOT_TOKEN_VM9: 'x' } }));
    void r;
    const r2 = checkBot('vm2', {
      readUnit: () => unitFor('vm2', { port: 8899, route: '/tty2/' }),
      unitActive: () => true,
      readCaddy: () => caddyFor('vm2', { port: 8899, route: '/tty2/' }),
      gatewayEnv: { TUI_BOT_TOKEN_VM2: 'tok', TUI_TTYD_URL_VM2: 'http://127.0.0.1:8899' },
    });
    assert.equal(r2.items.route, true);
    assert.equal(r2.items.caddyHandle, true);
    assert.equal(r2.ok, true, JSON.stringify(r2.items));
  });

  it("another bot's stanza does not pass this bot", () => {
    const other = caddyFor('vm2', { port: 8899, route: '/tty2/' });
    const r = checkBot('vm9', readers({ readCaddy: () => other }));
    assert.equal(r.items.caddyHandle, false);
  });
});

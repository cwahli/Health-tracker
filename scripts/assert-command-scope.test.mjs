import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  audit,
  readCanonicalCommands,
  readRegistry,
  readRouterSurface,
  run,
} from './assert-command-scope.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A minimal, valid surface. Tests perturb exactly one thing. */
function fixture(over = {}) {
  return {
    canonical: ['help', 'status', 'tui'],
    published: ['help', 'status'],
    handled: ['help', 'status'],
    matrix: { help: true, status: true, tui: false },
    routerOnly: [],
    ...over,
  };
}

const kinds = (r) => r.failures.map((f) => f.kind).sort();

test('real tree passes the gate', () => {
  const out = run();
  assert.equal(out.ok, true, `real tree failed: ${JSON.stringify(out.failures, null, 2)}`);
});

test('a clean fixture passes', () => {
  assert.equal(audit(fixture()).ok, true);
});

// --- the regression that motivated this gate -------------------------------

test('REGRESSION: an undeclared command fails (/tui shipped exactly this way)', () => {
  // /tui is canonical, the router does not publish it, and nobody declared a
  // verdict. Pre-fix this was silent; the gate must reject it.
  const r = audit(fixture({ matrix: { help: true, status: true } }));
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ['undeclared-command']);
  assert.equal(r.failures[0].command, 'tui');
});

test('declaring /tui false (bot-specific) makes the gap intentional and passing', () => {
  assert.equal(audit(fixture()).ok, true);
  const r = audit(fixture({ matrix: { help: true, status: true, tui: false } }));
  assert.equal(r.ok, true);
});

// --- dead buttons ----------------------------------------------------------

test('published but not handled is a dead button and fails', () => {
  const r = audit(fixture({ published: ['help', 'status'], handled: ['help'] }));
  assert.equal(r.ok, false);
  assert.ok(kinds(r).includes('published-not-handled'));
  assert.equal(r.failures.find((f) => f.kind === 'published-not-handled').command, 'status');
});

test('handled but not published is invisible and fails', () => {
  const r = audit(fixture({ published: ['help'], handled: ['help', 'status'] }));
  assert.equal(r.ok, false);
  assert.ok(kinds(r).includes('handled-not-published'));
});

test('a command published for an excluded class fails', () => {
  const r = audit(fixture({ published: ['help', 'status', 'tui'], handled: ['help', 'status', 'tui'] }));
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ['published-but-excluded']);
});

test('a non-canonical published command must be declared routerOnly', () => {
  const orphan = audit(fixture({
    published: ['help', 'status', 'switch'],
    handled: ['help', 'status', 'switch'],
  }));
  assert.equal(orphan.ok, false);
  assert.deepEqual(kinds(orphan), ['orphan-published']);

  const declared = audit(fixture({
    published: ['help', 'status', 'switch'],
    handled: ['help', 'status', 'switch'],
    routerOnly: ['switch'],
  }));
  assert.equal(declared.ok, true);
});

test('a non-boolean verdict fails rather than being coerced', () => {
  // 'adapter' is a legal per-CLASS value in capabilities.json, but a per-COMMAND
  // verdict is strictly boolean. Publishing /status with a non-boolean verdict
  // therefore trips both the type rule and the exclusion rule.
  const r = audit(fixture({ matrix: { help: true, status: 'adapter', tui: false } }));
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ['bad-verdict', 'published-but-excluded']);
  assert.equal(r.failures.find((f) => f.kind === 'bad-verdict').command, 'status');
});

// --- hidden aliases (/think -> /thinking) ----------------------------------

test('a declared alias may be handled without being published', () => {
  const r = audit(fixture({
    published: ['help', 'status'],
    handled: ['help', 'status', 'think'],
    aliases: ['think'],
  }));
  assert.equal(r.ok, true);
});

test('an undeclared handled-only command still fails', () => {
  const r = audit(fixture({
    published: ['help', 'status'],
    handled: ['help', 'status', 'think'],
  }));
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ['handled-not-published']);
});

test('an alias that is not handled fails (no lying declarations)', () => {
  const r = audit(fixture({ aliases: ['think'] }));
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ['alias-not-handled']);
});

test('an alias that is also published fails — advertise the canonical name', () => {
  // 'think' is not canonical, so publishing it trips both rules; both are true.
  const r = audit(fixture({
    published: ['help', 'status', 'think'],
    handled: ['help', 'status', 'think'],
    aliases: ['think'],
  }));
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ['alias-is-published', 'orphan-published']);
});

test('the real tree publishes canonical /thinking and keeps /think as an alias', () => {
  const out = run();
  assert.equal(out.ok, true, JSON.stringify(out.failures));
  assert.ok(out.published.includes('thinking'), 'popup must advertise /thinking');
  assert.ok(!out.published.includes('think'), 'popup must not advertise the /think alias');
  assert.ok(out.handled.includes('think'), '/think must stay a working alias');
  // `/freemodel` joined it (BOT-26): the router still HANDLES the old name — it
  // answers a one-line pointer so muscle memory does not fall through to a model
  // prompt — and no longer publishes it. An alias target has to be published, so
  // it cannot live in COMMAND_ALIASES any more; it is declared here instead.
  assert.deepEqual(out.aliases, ['think', 'freemodel', 'model']);
});

// --- parsers ---------------------------------------------------------------

test('reads canonical commands from scripts/lib/commands.mjs', () => {
  const cmds = readCanonicalCommands();
  assert.ok(cmds.includes('tui'), 'expected /tui in the canonical list');
  assert.ok(cmds.includes('thinking'), 'expected /thinking in the canonical list');
  assert.ok(cmds.includes('allowance'));
});

test('the router popup and its handlers differ only by declared aliases', () => {
  const { published, handled } = readRouterSurface();
  const registry = readRegistry();
  const aliases = registry.commands.aliases || [];
  // The rule is SET-equality: which names are handled-but-unpublished. Array order
  // is not part of it — the source order of `bot.command(...)` is not something a
  // reader could act on — and with two aliases that accidental coupling began
  // reding this sensor for a reordering that changes nothing.
  assert.deepEqual(
    [...handled.filter((c) => !published.includes(c))].sort(),
    [...aliases].sort(),
    'handled-but-unpublished must be exactly the declared aliases',
  );
  assert.ok(published.includes('switch'), 'router owns /switch — it is a separate product');
  assert.ok(published.includes('thinking'), 'popup advertises the canonical /thinking');
});

test('every canonical command carries a grok_tg verdict in the registry', () => {
  const canonical = readCanonicalCommands();
  const row = readRegistry();
  const missing = canonical.filter((c) => row.commands[c] === undefined);
  assert.deepEqual(missing, [], `no grok_tg verdict for: ${missing.join(', ')}`);
});

// The reversal, pinned. 86e284f declared /tui out of scope for grok_tg and this
// test used to assert that declaration was deliberate. The terminal turned out
// to be a gateway service rather than a bot-host feature, so the router serves
// it too — and the row, the verdict and the router surface must say so
// together, or the next reader re-litigates the question from a stale note.
test('the ui-tui row records the reversal so it is not re-litigated', () => {
  const caps = JSON.parse(readFileSync(path.join(ROOT, 'bots', 'capabilities.json'), 'utf8'));
  const row = caps.capabilities.find((c) => c.id === 'ui-tui');
  assert.ok(row, 'ui-tui row must exist');
  assert.equal(row.scope, 'runtime-adapter');
  assert.equal(row.classes.grok_tg, true);
  assert.ok(row.expect.includes('tools/telegram-provider-router/src/tui-miniapp.js'),
    'the router half of /tui must be in the row\'s expect list');
  assert.match(row.notes, /TUI_ROUTE_<BOT>_PATH/,
    'the note must name where the per-bot route is configured');

  const commands = caps.capabilities.find((c) => c.id === 'ui-commands');
  assert.equal(commands.commands.tui, true, 'the per-command grok_tg verdict must agree with the row');
});

test('the router really publishes and handles /tui, not just declares it', () => {
  const { published, handled } = readRouterSurface();
  assert.ok(published.includes('tui'), 'the router popup must list /tui');
  assert.ok(handled.includes('tui'), 'the router must register a /tui handler');
});

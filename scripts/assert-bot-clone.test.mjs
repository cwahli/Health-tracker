import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMasterDefaults } from './lib/registry.mjs';
import { audit, run, PER_BOT_KEYS } from './assert-bot-clone.mjs';

/**
 * The sensor for the clone contract.
 *
 * A gate never seen red is a gate nobody trusts (the same rule the TUI
 * fixes-landed ratchet is built on), so every check here is driven to its
 * failing fixture as well as its passing one — and `run()` is exercised against
 * the real registry so the thin rows themselves stay honest.
 */

const kinds = (r) => [...new Set(r.failures.map((f) => f.kind))].sort();

/**
 * Audit a raw registry through the REAL inheritance engine
 * (`applyMasterDefaults`), so the fixtures cannot pass by simulating an
 * inheritance that production does not perform.
 */
function auditRaw(raw, { resolved } = {}) {
  let r = resolved;
  if (!r) {
    try {
      r = applyMasterDefaults(structuredClone(raw));
    } catch {
      // A malformed master is exactly what one fixture is testing.
      r = structuredClone(raw);
    }
  }
  return audit({ raw, resolved: r });
}

function cleanFixture(over = {}) {
  return {
    master: 'vm',
    bots: [
      {
        id: 'vm',
        name: 'VM Bot',
        runtime: 'bot-host',
        enabled: true,
        telegram: { tokenEnv: 'VM_BOT_TOKEN', allowedUserIds: [1] },
        agent: { kind: 'opencode', model: 'opencode/one', sharedSkills: ['a', 'b'] },
        progress: { mode: 'concise', maxChars: 220 },
        session: { mode: 'per-chat' },
      },
      {
        id: 'clone',
        name: 'Clone Bot',
        runtime: 'bot-host',
        enabled: true,
        extends: 'vm',
        telegram: { tokenEnv: 'CLONE_BOT_TOKEN' },
        agent: { playwrightOutputDir: '/tmp/clone' },
      },
      {
        id: 'hermes_one',
        name: 'Hermes One',
        runtime: 'hermes',
        enabled: false,
        telegram: { tokenEnv: 'HERMES_ONE_TOKEN' },
        agent: { kind: 'hermes' },
      },
    ],
    ...over,
  };
}

const bot = (raw, id) => raw.bots.find((b) => b.id === id);

// --- the real tree ---------------------------------------------------------

test('the real registry passes the gate', () => {
  const out = run();
  assert.equal(out.ok, true, `real registry failed: ${JSON.stringify(out.failures, null, 2)}`);
  assert.equal(out.masterId, 'vm');
});

test('the real tree audits at least one thin clone', () => {
  const out = run();
  assert.ok(out.passes.some((p) => p.detail.includes('thin row')), 'no thin clone found — is the registry de-duplicated?');
});

// --- clean fixture ---------------------------------------------------------

test('a clean thin fixture passes', () => {
  assert.equal(auditRaw(cleanFixture()).failures.length, 0);
});

test('a foreign-runtime row is declared exempt, never judged', () => {
  const r = auditRaw(cleanFixture());
  assert.deepEqual(r.exemptions.map((e) => e.bot), ['hermes_one']);
});

// --- the regression this gate exists for -----------------------------------

test('REGRESSION: a hand-copied agent block fails as hand-copied-block', () => {
  // The old habit: paste the master's `agent` block into the child. It resolves
  // identically the day it is written, and silently keeps the old value the day
  // the master moves. Nothing else in the repo objected to this.
  const raw = cleanFixture();
  bot(raw, 'clone').agent = { ...structuredClone(bot(raw, 'vm').agent), playwrightOutputDir: '/tmp/clone' };
  const r = auditRaw(raw);
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ['hand-copied-block']);
  // `agent.kind` pins the regression, not `agent.model`: model is a deliberate
  // per-bot key (PER_BOT_KEYS justification — checker independence), so a
  // copied model is allowed on purpose while the copied block still fails.
  assert.ok(r.failures.some((f) => f.path === 'agent.kind'));
});

test('a master change reaches every thin clone (the reason cloning is safe)', () => {
  const raw = cleanFixture();
  assert.equal(auditRaw(raw).failures.length, 0);
  bot(raw, 'vm').agent.model = 'opencode/two'; // the master moves
  const after = auditRaw(raw);
  assert.equal(after.ok, true, 'a thin clone cannot drift when the master moves');
  const resolved = applyMasterDefaults(structuredClone(raw));
  assert.equal(resolved.bots.find((b) => b.id === 'clone').agent.model, 'opencode/two');
});

test('the same master change strands a hand-copied block (the silent loss)', () => {
  const raw = cleanFixture();
  bot(raw, 'clone').agent = { ...structuredClone(bot(raw, 'vm').agent) };
  bot(raw, 'vm').agent.model = 'opencode/two';
  const resolved = applyMasterDefaults(structuredClone(raw));
  assert.equal(
    resolved.bots.find((b) => b.id === 'clone').agent.model,
    'opencode/one',
    'this is the feature-loss the gate prevents: the copy keeps the old model',
  );
  assert.equal(auditRaw(raw).ok, false);
});

// --- undeclared override ---------------------------------------------------

test('an override of an inherited surface fails until it is allowed on purpose', () => {
  const raw = cleanFixture();
  bot(raw, 'clone').progress = { maxChars: 400 }; // flood control is fleet policy
  const r = auditRaw(raw);
  assert.equal(r.ok, false);
  assert.ok(kinds(r).includes('undeclared-override'));
  assert.ok(r.failures.some((f) => f.path === 'progress.maxChars'));
});

test('an allowlisted per-bot key is accepted', () => {
  const raw = cleanFixture();
  bot(raw, 'clone').agent.playwrightOutputDir = '/tmp/other';
  bot(raw, 'clone').agent.workspace = '/srv/other-checkout';
  assert.equal(auditRaw(raw).failures.length, 0);
});

test('agent.skills is additive: a clone may add a skill, never drop one', () => {
  const raw = cleanFixture();
  bot(raw, 'clone').agent.skills = ['c'];
  assert.equal(auditRaw(raw).failures.length, 0);
  const resolved = applyMasterDefaults(structuredClone(raw));
  assert.deepEqual(resolved.bots.find((b) => b.id === 'clone').agent.sharedSkills, ['a', 'b', 'c']);
});

test('dropping one inherited skill fails as skills-lost', () => {
  const raw = cleanFixture();
  bot(raw, 'clone').agent.sharedSkills = ['a'];
  const r = auditRaw(raw);
  assert.equal(r.ok, false);
  assert.ok(kinds(r).includes('skills-lost'));
});

// --- safety rails ----------------------------------------------------------

test('two bots sharing one token fails (one token is one poller)', () => {
  const raw = cleanFixture();
  bot(raw, 'clone').telegram.tokenEnv = 'VM_BOT_TOKEN';
  const r = auditRaw(raw);
  assert.equal(r.ok, false);
  assert.ok(kinds(r).includes('shared-token'));
});

test('a master that extends another bot fails', () => {
  const raw = cleanFixture();
  bot(raw, 'vm').extends = 'clone';
  const r = auditRaw(raw);
  assert.equal(r.ok, false);
  assert.ok(kinds(r).includes('master-extends'));
});

test('a registry row cannot fork the command surface', () => {
  const raw = cleanFixture();
  bot(raw, 'clone').commands = ['help'];
  const r = auditRaw(raw);
  assert.equal(r.ok, false);
  assert.ok(kinds(r).includes('command-fork'));
});

test('a missing master is reported, not thrown', () => {
  const raw = cleanFixture({ master: 'nope' });
  const r = auditRaw(raw, { resolved: { master: 'nope', bots: raw.bots } });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ['no-master']);
});

// --- the allowlist itself is the reviewed surface --------------------------

test('the per-bot allowlist stays small and explicit', async () => {
  // A grown allowlist is how "the master supplies it" quietly stops being true.
  assert.ok(PER_BOT_KEYS.size <= 15, `allowlist grew to ${PER_BOT_KEYS.size} keys — justify it in review`);
  assert.ok(PER_BOT_KEYS.has('telegram'));
  assert.ok(!PER_BOT_KEYS.has('progress.maxChars'), 'flood control must stay inherited');
  // `agent.model` is the single documented exception: checker independence
  // (chiwah-tax BOT_GROUP.md) requires the verifier on a different provider
  // than the maker. The exception stays reviewed by pinning its justification
  // in the gate source — remove the justification and this fails.
  assert.ok(PER_BOT_KEYS.has('agent.model'), 'model exception removed — the verifier architecture depends on it');
  const { readFileSync } = await import('node:fs');
  const gateSrc = readFileSync(new URL('./assert-bot-clone.mjs', import.meta.url), 'utf8');
  assert.ok(gateSrc.includes('agent.model') && /independence/i.test(gateSrc), 'model exception must carry its justification in the gate source');
});

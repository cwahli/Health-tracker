#!/usr/bin/env node
/**
 * assert-bot-peer-policy.test.mjs — the sensor for WHO may address WHICH seat.
 *
 * Run: node scripts/assert-bot-peer-policy.test.mjs
 *
 * Covers the pure policy half of B2B-1 (scripts/lib/tg-peers.mjs): default-deny,
 * the three sender policies, the `open` refusal, self-address, directed edges
 * (never inferred), and username resolution that refuses on a cache miss
 * instead of calling Telegram. No network, no live bot, no state written outside
 * a throwaway temp dir.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  BOT,
  HUMAN,
  POLICY_ALLOWLISTED_BOTS,
  POLICY_HUMANS_ONLY,
  REFUSAL,
  findSeatByUsername,
  listAddressablePeers,
  normalizePeers,
  peerEdge,
  receiveVerdict,
  resolvePeerUsername,
  resolvePolicy,
  sendVerdict,
  senderTypeOf,
} from './lib/tg-peers.mjs';

import {
  DEFAULTS,
  KINDS,
  TERMINAL_KINDS,
  checkReceiveBounds,
  checkSendBounds,
  deadLetter,
  decodeEnvelope,
  emptyLedger,
  encodeEnvelope,
  proposalLine,
} from './lib/tg-handoff.mjs';

let passed = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${label}`);
  } catch (err) {
    failures.push({ label, err });
    console.log(`FAIL ${label}: ${err?.message || err}`);
  }
}

const PEERS = {
  vm3: { pm: { maxDepth: 2, cooldownMs: 60_000, ttlMs: 1_800_000 } },
};

console.log('assert-bot-peer-policy:');

/* ---------------------------------------------------------- sender type --- */

check('a user update is human', () => {
  assert.equal(senderTypeOf({ id: 6218257274, is_bot: false }), HUMAN);
});

check('a bot update is a bot', () => {
  assert.equal(senderTypeOf({ id: 777000, is_bot: true }), BOT);
});

check('an update with no id is not a sender at all', () => {
  assert.equal(senderTypeOf({ is_bot: true }), null);
  assert.equal(senderTypeOf(null), null);
  assert.equal(senderTypeOf(undefined), null);
});

/* --------------------------------------------------------------- policy --- */

check('no configured policy defaults to humans-only', () => {
  assert.equal(resolvePolicy(undefined), POLICY_HUMANS_ONLY);
  assert.equal(resolvePolicy(''), POLICY_HUMANS_ONLY);
});

check('a typo in the policy var does not widen access', () => {
  assert.equal(resolvePolicy('humans-and-bots'), POLICY_HUMANS_ONLY);
  assert.equal(resolvePolicy('HUMANS-ONLY'), POLICY_HUMANS_ONLY);
});

check('policy "open" is refused outside tests', () => {
  assert.equal(resolvePolicy('open'), POLICY_HUMANS_ONLY);
  assert.equal(resolvePolicy('open', { isTest: true }), 'open');
});

check('humans-and-allowlisted-bots is honoured', () => {
  assert.equal(
    resolvePolicy(POLICY_ALLOWLISTED_BOTS),
    POLICY_ALLOWLISTED_BOTS,
  );
});

/* ------------------------------------------------------- send verdicts --- */

check('under humans-only a bot may not send, even to a listed peer', () => {
  const v = sendVerdict({ policy: POLICY_HUMANS_ONLY, peers: PEERS, from: 'vm3', to: 'pm' });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'POLICY_HUMANS_ONLY');
  assert.equal(v.reason, REFUSAL.POLICY_HUMANS_ONLY);
});

check('default-deny: no peers entry means no send', () => {
  const v = sendVerdict({
    policy: POLICY_ALLOWLISTED_BOTS,
    peers: PEERS,
    from: 'vm4',
    to: 'pm',
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'PEER_NOT_ALLOWED');
  assert.deepEqual(v.peers, []);
});

check('the listed direction is allowed and carries its bounds', () => {
  const v = sendVerdict({
    policy: POLICY_ALLOWLISTED_BOTS,
    peers: PEERS,
    from: 'vm3',
    to: 'pm',
  });
  assert.equal(v.ok, true);
  assert.equal(v.edge.maxDepth, 2);
  assert.equal(v.edge.cooldownMs, 60_000);
  assert.equal(v.edge.ttlMs, 1_800_000);
});

check('the edge is directed: pm may not answer vm3 until a packet says so', () => {
  const v = sendVerdict({
    policy: POLICY_ALLOWLISTED_BOTS,
    peers: PEERS,
    from: 'pm',
    to: 'vm3',
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'PEER_NOT_ALLOWED');
  assert.deepEqual(v.peers, []);
});

check('a seat may not address itself', () => {
  const v = sendVerdict({
    policy: POLICY_ALLOWLISTED_BOTS,
    peers: { vm3: { vm3: {} } },
    from: 'vm3',
    to: 'vm3',
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'SELF_ADDRESS');
});

check('missing sender or target is refused, not guessed', () => {
  const noFrom = sendVerdict({ policy: POLICY_ALLOWLISTED_BOTS, peers: PEERS, from: '', to: 'pm' });
  assert.equal(noFrom.code, 'SENDER_UNKNOWN');
  const noTo = sendVerdict({ policy: POLICY_ALLOWLISTED_BOTS, peers: PEERS, from: 'vm3', to: '' });
  assert.equal(noTo.code, 'TARGET_UNKNOWN');
});

check('under test-only "open" any distinct pair resolves', () => {
  const v = sendVerdict({ policy: 'open', peers: {}, from: 'vm3', to: 'anything', isTest: true });
  assert.equal(v.ok, true);
});

check('receive and send agree on the same pair', () => {
  const args = { policy: POLICY_ALLOWLISTED_BOTS, peers: PEERS, from: 'vm3', to: 'pm' };
  assert.deepEqual(receiveVerdict(args), sendVerdict(args));
});

/* ---------------------------------------------------------------- edges --- */

check('an absent edge is null, never inferred from the reverse direction', () => {
  assert.equal(peerEdge(PEERS, 'pm', 'vm3'), null);
  assert.equal(peerEdge(undefined, 'vm3', 'pm'), null);
  assert.equal(peerEdge(PEERS, 'vm3', 'pm').maxDepth, 2);
});

check('a malformed edge falls back to the safe defaults', () => {
  const edge = peerEdge({ vm3: { pm: { maxDepth: -1, cooldownMs: 'x', ttlMs: 0 } } }, 'vm3', 'pm');
  assert.equal(edge.maxDepth, 2);
  assert.equal(edge.cooldownMs, 60_000);
  assert.equal(edge.ttlMs, 1_800_000);
});

check('normalizePeers drops non-object rows instead of injecting them', () => {
  const out = normalizePeers({ vm3: { pm: { maxDepth: 3 } }, vm4: 'nope', vm5: { pm: null } });
  assert.deepEqual(Object.keys(out), ['vm3']);
  assert.equal(out.vm3.pm.maxDepth, 3);
});

check('listAddressablePeers is sorted, so a refusal message is stable', () => {
  const peers = { vm3: { pm: {}, android: {}, opencode: {} } };
  assert.deepEqual(listAddressablePeers(peers, 'vm3'), ['android', 'opencode', 'pm']);
  assert.deepEqual(listAddressablePeers(peers, 'nobody'), []);
});

/* ------------------------------------------------------------ addressing --- */

const stateDir = mkdtempSync(path.join(tmpdir(), 'tg-peers-'));

check('a peer that wrote its own identity resolves to @username', () => {
  mkdirSync(path.join(stateDir, 'pm'), { recursive: true });
  writeFileSync(
    path.join(stateDir, 'pm', 'identity.json'),
    JSON.stringify({ id: 'pm', username: 'ht_pm_bot', telegramId: 12345 }),
  );
  const v = resolvePeerUsername(stateDir, 'pm');
  assert.equal(v.ok, true);
  assert.equal(v.username, '@ht_pm_bot');
  assert.equal(v.telegramId, 12345);
});

check('a leading @ in the cache is normalised away', () => {
  mkdirSync(path.join(stateDir, 'vm3'), { recursive: true });
  writeFileSync(path.join(stateDir, 'vm3', 'identity.json'), JSON.stringify({ username: '@ht_vm3_bot' }));
  assert.equal(resolvePeerUsername(stateDir, 'vm3').username, '@ht_vm3_bot');
});

check('a cache miss refuses and names the bot — it never calls Telegram', () => {
  const v = resolvePeerUsername(stateDir, 'ghost');
  assert.equal(v.ok, false);
  assert.equal(v.code, 'PEER_NO_IDENTITY_CACHE');
  assert.equal(v.botId, 'ghost');
});

check('an unparseable identity file refuses rather than half-addressing', () => {
  mkdirSync(path.join(stateDir, 'broken'), { recursive: true });
  writeFileSync(path.join(stateDir, 'broken', 'identity.json'), '{not json');
  assert.equal(resolvePeerUsername(stateDir, 'broken').code, 'PEER_NO_IDENTITY_CACHE');
});

check('an identity with no username refuses with its own code', () => {
  mkdirSync(path.join(stateDir, 'nouser'), { recursive: true });
  writeFileSync(path.join(stateDir, 'nouser', 'identity.json'), JSON.stringify({ telegramId: 1 }));
  const v = resolvePeerUsername(stateDir, 'nouser');
  assert.equal(v.ok, false);
  assert.equal(v.code, 'PEER_NO_USERNAME');
});

check('an empty target id is refused before any file read', () => {
  assert.equal(resolvePeerUsername(stateDir, '  ').code, 'TARGET_UNKNOWN');
});

check('a sender username resolves back to its seat id', () => {
  const hit = findSeatByUsername(stateDir, '@ht_pm_bot');
  assert.equal(hit.seat, 'pm');
  assert.equal(hit.telegramId, 12345);
  assert.equal(findSeatByUsername(stateDir, 'ht_pm_bot').seat, 'pm', 'the @ is optional');
});

check('a username no seat has claimed resolves to nothing, so it is not a peer', () => {
  assert.equal(findSeatByUsername(stateDir, '@someone_else_bot'), null);
  assert.equal(findSeatByUsername(stateDir, ''), null);
  assert.equal(findSeatByUsername(path.join(stateDir, 'nope'), 'ht_pm_bot'), null);
});

/* ============================================================ handoff ==== */

const T0 = 1_790_000_000_000;

function ask(overrides = {}) {
  return encodeEnvelope({
    from: 'vm3',
    to: 'pm',
    kind: 'ask',
    ref: 'spec:fleet-current-tab',
    body: 'the current tab has no card rows — is D1 the source or the sheet?',
    now: T0,
    ...overrides,
  });
}

check('the six kinds are exactly the contract, and two of them end a chain', () => {
  assert.deepEqual(KINDS, ['ask', 'answer', 'blocked', 'handoff-request', 'ack', 'close']);
  assert.deepEqual(TERMINAL_KINDS, ['ack', 'close']);
});

check('an envelope round-trips through the chat text', () => {
  const built = ask();
  assert.equal(built.ok, true);
  assert.equal(built.text.split('\n').length, 2, 'one header line plus prose');
  assert.ok(built.text.startsWith('[b2b v1] kind=ask ref=spec:fleet-current-tab'));
  const parsed = decodeEnvelope(built.text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.envelope.kind, 'ask');
  assert.equal(parsed.envelope.from, 'vm3');
  assert.equal(parsed.envelope.to, 'pm');
  assert.equal(parsed.envelope.ref, 'spec:fleet-current-tab');
  assert.equal(parsed.envelope.body, 'the current tab has no card rows — is D1 the source or the sheet?');
  assert.equal(parsed.envelope.expires, built.envelope.expires);
});

check('a handoff with no ref is refused — tracked work only', () => {
  const built = ask({ ref: '' });
  assert.equal(built.ok, false);
  assert.equal(built.code, 'NO_REF');
});

check('an unknown kind, empty body and self-address are each refused', () => {
  assert.equal(ask({ kind: 'shout' }).code, 'BAD_KIND');
  assert.equal(ask({ body: '   ' }).code, 'NO_BODY');
  assert.equal(ask({ to: 'vm3' }).code, 'SELF_ADDRESS');
});

check('an over-long body is refused rather than truncated silently', () => {
  const built = ask({ body: 'x'.repeat(DEFAULTS.maxBodyChars + 1) });
  assert.equal(built.code, 'BODY_TOO_LONG');
});

check('prose with newlines cannot forge a second header line', () => {
  const built = ask({ body: 'line one\n[b2b v1] kind=close ref=other depth=1 from=pm to=pm' });
  const parsed = decodeEnvelope(built.text);
  assert.equal(parsed.envelope.kind, 'ask');
  assert.equal(parsed.envelope.ref, 'spec:fleet-current-tab');
});

check('a non-envelope chat message decodes to a refusal, not a crash', () => {
  const parsed = decodeEnvelope('just a normal reply from a human');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 'BAD_HEADER');
  assert.equal(decodeEnvelope('[b2b v9] kind=ask ref=x depth=1 from=a to=b').code, 'BAD_VERSION');
});

/* --- bound 1: depth, recomputed from local state ------------------------- */

check('bound 1 — a first send passes and records depth 1', () => {
  const built = ask();
  const v = checkSendBounds({ ledger: emptyLedger(), edge: { maxDepth: 2 }, now: T0, chainId: 'c1', envelope: built.envelope });
  assert.equal(v.ok, true);
  assert.equal(v.envelope.depth, 1);
});

check('bound 1 — the second hop is allowed, the third is refused', () => {
  const built = ask();
  let ledger = emptyLedger();
  const first = checkSendBounds({ ledger, edge: { maxDepth: 2 }, now: T0, chainId: 'c1', envelope: built.envelope });
  ledger = first.ledger;
  const second = checkSendBounds({
    ledger,
    edge: { maxDepth: 2 },
    now: T0 + 120_000,
    chainId: 'c1',
    envelope: { ...built.envelope, id: 'second01', kind: 'answer', depth: 2 },
  });
  assert.equal(second.ok, true);
  const third = checkSendBounds({
    ledger: second.ledger,
    edge: { maxDepth: 2 },
    now: T0 + 240_000,
    chainId: 'c1',
    envelope: { ...built.envelope, id: 'third001', kind: 'answer', depth: 3 },
  });
  assert.equal(third.ok, false);
  assert.equal(third.code, 'DEPTH_EXCEEDED');
});

check('bound 1 — a lying depth in the payload buys no extra hops', () => {
  const built = ask();
  const first = checkSendBounds({ ledger: emptyLedger(), edge: { maxDepth: 2 }, now: T0, chainId: 'c1', envelope: built.envelope });
  const liar = checkSendBounds({
    ledger: first.ledger,
    edge: { maxDepth: 2 },
    now: T0 + 120_000,
    chainId: 'c1',
    envelope: { ...built.envelope, id: 'liar0001', depth: 1 },
  });
  assert.equal(liar.envelope.depth, 2, 'depth comes from local chain state, not the payload');
  const third = checkSendBounds({
    ledger: liar.ledger,
    edge: { maxDepth: 2 },
    now: T0 + 240_000,
    chainId: 'c1',
    envelope: { ...built.envelope, id: 'liar0002', depth: 1 },
  });
  assert.equal(third.code, 'DEPTH_EXCEEDED');
});

/* --- bound 2: per-pair cooldown ----------------------------------------- */

check('bound 2 — a second message inside the cooldown window is refused', () => {
  const built = ask();
  const first = checkSendBounds({ ledger: emptyLedger(), edge: { maxDepth: 2, cooldownMs: 60_000 }, now: T0, chainId: 'c1', envelope: built.envelope });
  const tooSoon = checkSendBounds({
    ledger: first.ledger,
    edge: { maxDepth: 2, cooldownMs: 60_000 },
    now: T0 + 1_000,
    chainId: 'c2',
    envelope: { ...built.envelope, id: 'cooldown' },
  });
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.code, 'COOLDOWN');
});

check('bound 2 — after the window the same pair may send again', () => {
  const built = ask();
  const first = checkSendBounds({ ledger: emptyLedger(), edge: { maxDepth: 2, cooldownMs: 60_000 }, now: T0, chainId: 'c1', envelope: built.envelope });
  const later = checkSendBounds({
    ledger: first.ledger,
    edge: { maxDepth: 2, cooldownMs: 60_000 },
    now: T0 + 60_001,
    chainId: 'c2',
    envelope: { ...built.envelope, id: 'later001' },
  });
  assert.equal(later.ok, true);
});

/* --- bound 3: global send budget ---------------------------------------- */

check('bound 3 — the mesh-wide budget caps sends even to distinct peers', () => {
  let ledger = emptyLedger();
  for (let i = 0; i < 3; i += 1) {
    const built = ask({ id: `budget${i}` });
    const v = checkSendBounds({
      ledger,
      edge: { maxDepth: 5, cooldownMs: 0 },
      now: T0 + i,
      chainId: `c${i}`,
      envelope: built.envelope,
      globalBudget: 3,
    });
    assert.equal(v.ok, true, `send ${i} should pass`);
    ledger = v.ledger;
  }
  const overflow = checkSendBounds({
    ledger,
    edge: { maxDepth: 5, cooldownMs: 0 },
    now: T0 + 10,
    chainId: 'c9',
    envelope: ask({ id: 'budgetX' }).envelope,
    globalBudget: 3,
  });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.code, 'GLOBAL_BUDGET');
});

check('bound 3 — the budget window slides instead of latching forever', () => {
  let ledger = emptyLedger();
  for (let i = 0; i < 2; i += 1) {
    ledger = checkSendBounds({
      ledger,
      edge: { maxDepth: 5, cooldownMs: 0 },
      now: T0 + i,
      chainId: `c${i}`,
      envelope: ask({ id: `win${i}` }).envelope,
      globalBudget: 2,
    }).ledger;
  }
  const afterWindow = checkSendBounds({
    ledger,
    edge: { maxDepth: 5, cooldownMs: 0 },
    now: T0 + DEFAULTS.globalWindowMs + 1,
    chainId: 'c5',
    envelope: ask({ id: 'winX' }).envelope,
    globalBudget: 2,
  });
  assert.equal(afterWindow.ok, true);
});

/* --- bound 4: dedupe ---------------------------------------------------- */

check('bound 4 — the same message id is refused a second time on send', () => {
  const built = ask({ id: 'dupe1234' });
  const first = checkSendBounds({ ledger: emptyLedger(), edge: { maxDepth: 2, cooldownMs: 0 }, now: T0, chainId: 'c1', envelope: built.envelope });
  const replay = checkSendBounds({ ledger: first.ledger, edge: { maxDepth: 2, cooldownMs: 0 }, now: T0 + 1, chainId: 'c2', envelope: built.envelope });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'DUPLICATE');
});

check('bound 4 — a replayed inbound message is received once', () => {
  const built = ask({ id: 'inbound1' });
  const first = checkReceiveBounds({ ledger: emptyLedger(), envelope: built.envelope, now: T0, self: 'pm' });
  assert.equal(first.ok, true);
  const replay = checkReceiveBounds({ ledger: first.ledger, envelope: built.envelope, now: T0 + 1, self: 'pm' });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'DUPLICATE');
});

/* --- bound 5: TTL ------------------------------------------------------- */

check('bound 5 — an unanswered question expires instead of lingering', () => {
  const built = ask({ ttlMs: 1_800_000 });
  const late = checkReceiveBounds({ ledger: emptyLedger(), envelope: built.envelope, now: T0 + 1_800_001, self: 'pm' });
  assert.equal(late.ok, false);
  assert.equal(late.code, 'EXPIRED');
});

check('bound 5 — inside the window the same question is still receivable', () => {
  const built = ask({ ttlMs: 1_800_000 });
  const ok = checkReceiveBounds({ ledger: emptyLedger(), envelope: built.envelope, now: T0 + 1_799_999, self: 'pm' });
  assert.equal(ok.ok, true);
});

/* --- addressing and termination ---------------------------------------- */

check('an envelope addressed to another seat is not ours to accept', () => {
  const built = ask({ to: 'vm4' });
  const v = checkReceiveBounds({ ledger: emptyLedger(), envelope: built.envelope, now: T0, self: 'pm' });
  assert.equal(v.ok, false);
  assert.match(v.reason, /addressed to vm4/);
});

check('nothing may follow an ack or a close', () => {
  const built = ask({ id: 'term001', kind: 'ack' });
  const acked = checkSendBounds({ ledger: emptyLedger(), edge: { maxDepth: 4, cooldownMs: 0 }, now: T0, chainId: 'c1', envelope: built.envelope });
  assert.equal(acked.ok, true);
  const after = checkSendBounds({
    ledger: acked.ledger,
    edge: { maxDepth: 4, cooldownMs: 0 },
    now: T0 + 10_000,
    chainId: 'c1',
    envelope: ask({ id: 'term002' }).envelope,
  });
  assert.equal(after.ok, false);
  assert.equal(after.code, 'AFTER_TERMINAL');
});

check('the receive side refuses to extend a terminated chain too', () => {
  const acked = checkReceiveBounds({ ledger: emptyLedger(), envelope: ask({ id: 'rterm01', kind: 'close' }).envelope, now: T0, self: 'pm' });
  assert.equal(acked.ok, true);
  const reply = checkReceiveBounds({
    ledger: acked.ledger,
    envelope: ask({ id: 'rterm02', kind: 'answer', reply_to: 'rterm01' }).envelope,
    now: T0 + 1_000,
    self: 'pm',
  });
  assert.equal(reply.ok, false);
  assert.equal(reply.code, 'AFTER_TERMINAL');
});

/* --- dead letter -------------------------------------------------------- */

const dlDir = path.join(stateDir, 'dead-letter');

check('a refused envelope lands in a dead-letter file, never a silent drop', () => {
  const first = checkSendBounds({
    ledger: emptyLedger(),
    edge: { maxDepth: 2, cooldownMs: 0 },
    now: T0,
    chainId: 'c1',
    envelope: ask({ id: 'dlfirst01' }).envelope,
  });
  assert.equal(first.ok, true, 'the first send is allowed, so the second can be refused');
  const built = ask({ id: 'dl000002' });
  const refused = checkSendBounds({ ledger: first.ledger, edge: { maxDepth: 1, cooldownMs: 0 }, now: T0 + 120_000, chainId: 'c1', envelope: built.envelope });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'DEPTH_EXCEEDED');
  const file = deadLetter(dlDir, { envelope: built.envelope, code: refused.code, reason: refused.reason, at: T0 });
  assert.ok(file && file.endsWith('.json'), 'dead-letter path returned');
  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(written.code, 'DEPTH_EXCEEDED');
  assert.equal(written.envelope.ref, 'spec:fleet-current-tab');
  assert.ok(written.at.startsWith('2026-'), 'ISO timestamp');
});

check('a dead-letter write that cannot happen returns null instead of throwing', () => {
  assert.equal(deadLetter(path.join(stateDir, 'x', '\0bad'), { reason: 'nope' }), null);
});

check('a proposal line names the ref and the reply command, not the raw envelope', () => {
  const built = ask();
  const line = proposalLine(built.envelope, { self: 'pm' });
  assert.ok(line.includes('ref spec:fleet-current-tab'));
  assert.ok(line.includes(`/tell vm3`));
  assert.ok(!line.includes('[b2b v1]'), 'the header stays in the transport, not the inbox');
});

rmSync(stateDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.label}\n${f.err?.stack || f.err}`);
  process.exit(1);
}
console.log('assert-bot-peer-policy: PASS');
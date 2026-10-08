#!/usr/bin/env node
/**
 * assert-b2b-collab.test.mjs — the sensor for the ONE thing that may cost a turn.
 *
 * Run: node scripts/assert-b2b-collab.test.mjs
 *
 * scripts/assert-bot-peer-policy.test.mjs proves peer MESSAGES cannot loop: they
 * are bounded by hops, bytes, windows and a terminal flag, and none of them ever
 * runs a model. That safety has one hole by design — a `delegate` and a
 * `feedback` are allowed to start a real agent turn, because two seats that
 * cannot hand work to each other are two note-takers rather than two
 * collaborators.
 *
 * This file proves the hole is bounded: per chain in turns, mesh-wide in a
 * window, in rounds, and in agreements. It also pins the two regressions that
 * cost real debugging while this was built — a first `agree` closing the chain
 * before the second could arrive, and depth being counted per reply so a 3-deep
 * cap allowed one round and a half.
 *
 * No network, no live bot, no state written outside a throwaway temp dir.
 */

import assert from 'node:assert/strict';

import {
  COLLAB_DEFAULTS,
  COLLAB_REFUSAL,
  KINDS,
  REPLY_KINDS,
  ROUND_KINDS,
  TERMINAL_KINDS,
  TURNS_KINDS,
  agreementState,
  chainIdOf,
  checkTurnBudget,
  delegationPrompt,
  readAgreement,
} from './lib/b2b-collab.mjs';
import {
  DEFAULTS,
  checkReceiveBounds,
  checkSendBounds,
  decodeEnvelope,
  emptyLedger,
  encodeEnvelope,
} from './lib/tg-handoff.mjs';

const T0 = 1_750_000_000_000;
let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err && err.message}`);
    console.log(String(err && err.stack).split('\n').slice(1, 3).join('\n'));
  }
}

/* ================================================================== B2B-2 ===
 * DELEGATION: the bounds that make a peer message able to cost a turn.
 *
 * The B2B-1 sensor proved messages could not loop. These prove that the ONE
 * exception — a peer message that starts an agent — is bounded harder than
 * messages were, because a turn runs a model and can answer back.
 */

/** An ordinary protocol envelope — the kind that must stay free. */
function ask(now = T0) {
  return encodeEnvelope({
    from: 'vm3', to: 'pm', kind: 'ask', ref: 'spec:fleet-current-tab',
    body: 'the current tab has no card rows — is D1 the source or the sheet?', now,
  });
}

/** A collaboration envelope, built the way the delegation path builds them. */
function collab({ from = 'vm4', to = 'vm5', kind = 'delegate', body = 'draft attached', chain = 'collab1', reply_to = '-', now = T0, ttlMs = 1_800_000 } = {}) {
  return encodeEnvelope({ from, to, kind, ref: 'gp-letter', body, depth: 1, now, ttlMs, reply_to, chain });
}

const COLLAB_EDGE = { maxDepth: 3, maxTurns: 4, maxRounds: 2, cooldownMs: 0, ttlMs: 1_800_000 };

/* ---- the vocabulary, which is the whole contract ------------------------- */

check('the kinds are exactly the contract, and three of them end a chain', () => {
  assert.deepEqual(KINDS, [
    'ask', 'answer', 'blocked', 'handoff-request', 'ack', 'close',
    'delegate', 'feedback', 'agree',
  ]);
  assert.deepEqual(TERMINAL_KINDS, ['ack', 'close', 'agree']);
});

check('only the two collaboration kinds may cost an agent turn', () => {
  // The load-bearing property. Everything else must stay free, or a bot-to-bot
  // flood becomes a bill instead of an inbox.
  assert.deepEqual(TURNS_KINDS, ['delegate', 'feedback']);
  for (const k of ['ask', 'answer', 'blocked', 'handoff-request', 'ack', 'close', 'agree']) {
    assert.equal(TURNS_KINDS.includes(k), false, `${k} must not spend a turn`);
  }
  assert.deepEqual(ROUND_KINDS, ['delegate']);
  assert.deepEqual(REPLY_KINDS, ['feedback', 'agree']);
  // `agree` decides nothing but still terminates, so it must not cost a turn
  // either — otherwise agreeing would be the most expensive thing in the loop.
  assert.equal(TERMINAL_KINDS.includes('agree'), true);
  assert.equal(TURNS_KINDS.includes('agree'), false);
});

check('the turn budget defaults are tighter than the message budget', () => {
  // Twenty messages a minute is chatter. Twenty turns a minute is a bill.
  assert.ok(COLLAB_DEFAULTS.maxTurns < DEFAULTS.globalBudget, 'a chain may not spend more turns than the mesh allows messages');
  assert.ok(COLLAB_DEFAULTS.globalTurns < DEFAULTS.globalBudget, 'mesh turns must be below the message budget');
  assert.ok(COLLAB_DEFAULTS.minAgreement >= 2, 'one seat agreeing with itself is not agreement');
});

check('the turn budget is a pure function — no clock, no network', () => {
  const v = checkTurnBudget({
    chain: {}, turns: [], now: T0,
    envelope: { kind: 'delegate', id: 'a', from: 'vm4', to: 'vm5' },
    edge: { maxTurns: 4, maxRounds: 2 },
  });
  assert.equal(v.ok, true);
  assert.equal(v.spendsTurn, true);
  assert.equal(v.round, 1);
  assert.equal(v.turnsUsed, 1);
  assert.equal(COLLAB_REFUSAL.TURN_BUDGET.includes('turn budget'), true);
});

check('a delegate is accepted, spends a turn, and opens round 1', () => {
  const built = collab();
  assert.equal(built.ok, true);
  const v = checkReceiveBounds({ ledger: emptyLedger(), envelope: built.envelope, now: T0, self: 'vm5', edge: COLLAB_EDGE });
  assert.equal(v.ok, true);
  assert.equal(v.spendsTurn, true);
  assert.equal(v.round, 1);
  assert.equal(v.turnsUsed, 1);
  assert.deepEqual(v.ledger.turns, [T0], 'the mesh turn log records it');
});

check('an ask spends nothing at all — the floor is unchanged for it', () => {
  const built = ask();
  const v = checkReceiveBounds({ ledger: emptyLedger(), envelope: built.envelope, now: T0, self: 'pm', edge: {} });
  assert.equal(v.ok, true);
  assert.equal(v.spendsTurn, false);
  assert.deepEqual(v.ledger.turns, [], 'no turn was logged');
  assert.equal(v.turnsUsed, 0);
});

check('the chain turn budget refuses the turn that would exceed it', () => {
  // maxRounds is deliberately generous here so the TURN budget is the bound
  // under test and not the round cap, which fires first when each delegate opens
  // a round of its own.
  const edge = { ...COLLAB_EDGE, maxTurns: 2, maxRounds: 10 };
  let led = emptyLedger();
  for (let i = 0; i < 2; i += 1) {
    const b = collab({ body: `round ${i}`, now: T0 + i * 1000 });
    const v = checkReceiveBounds({ ledger: led, envelope: b.envelope, now: T0 + i * 1000, self: 'vm5', edge });
    assert.equal(v.ok, true, `turn ${i + 1} fits the budget`);
    led = v.ledger;
  }
  const over = collab({ body: 'one too many', now: T0 + 3000 });
  const v = checkReceiveBounds({ ledger: led, envelope: over.envelope, now: T0 + 3000, self: 'vm5', edge });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'TURN_BUDGET');
  assert.match(v.reason, /1 of 2|2 of 2/, 'says how much was used');
});

check('the mesh turn window stops N seats collectively out-spending one', () => {
  const v = checkReceiveBounds({
    ledger: { ...emptyLedger(), turns: [T0, T0] },
    envelope: collab().envelope,
    now: T0,
    self: 'vm5',
    edge: COLLAB_EDGE,
    globalTurns: 2,
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'TURN_WINDOW');
});

check('a stale turn log does not block a new window', () => {
  const long = DEFAULTS.turnWindowMs + 1000;
  const v = checkReceiveBounds({
    ledger: { ...emptyLedger(), turns: [T0 - long] },
    envelope: collab({ now: T0 }).envelope,
    now: T0,
    self: 'vm5',
    edge: COLLAB_EDGE,
  });
  assert.equal(v.ok, true, 'the old turn is pruned out of the window');
});

check('rounds are capped, so two agreeable agents cannot polish forever', () => {
  const edge = { ...COLLAB_EDGE, maxTurns: 20, maxRounds: 2 };
  let led = emptyLedger();
  for (let round = 1; round <= 2; round += 1) {
    const b = collab({ body: `round ${round}`, now: T0 + round * 1000 });
    const v = checkReceiveBounds({ ledger: led, envelope: b.envelope, now: T0 + round * 1000, self: 'vm5', edge });
    assert.equal(v.ok, true, `round ${round} opens`);
    assert.equal(v.round, round);
    led = v.ledger;
  }
  const third = collab({ body: 'round 3', now: T0 + 3000 });
  const v = checkReceiveBounds({ ledger: led, envelope: third.envelope, now: T0 + 3000, self: 'vm5', edge });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'ROUNDS_EXHAUSTED');
});

check('a reply inside an open round does not consume depth', () => {
  // The reason depth had to be redefined: under the old "every hop counts" rule
  // a 3-deep cap allowed one round and a half, so collaboration was impossible.
  let led = emptyLedger();
  const d = collab({ body: 'work', now: T0 });
  led = checkReceiveBounds({ ledger: led, envelope: d.envelope, now: T0, self: 'vm5', edge: COLLAB_EDGE }).ledger;
  assert.equal(led.chains.collab1.depth, 1, 'the delegate is hop 1');
  const f = collab({ kind: 'feedback', from: 'vm5', to: 'vm4', body: 'my revision', now: T0 + 10, reply_to: d.envelope.id });
  const v = checkReceiveBounds({ ledger: led, envelope: f.envelope, now: T0 + 10, self: 'vm4', edge: COLLAB_EDGE });
  assert.equal(v.ok, true);
  assert.equal(v.ledger.chains.collab1.depth, 1, 'the reply did not add a hop');
  assert.equal(v.spendsTurn, true);
});

check('a second re-delegation is a new hop and still bounded', () => {
  const edge = { ...COLLAB_EDGE, maxDepth: 3, maxTurns: 10, maxRounds: 3 };
  let led = emptyLedger();
  const d = collab({ body: 'work', now: T0 });
  led = checkReceiveBounds({ ledger: led, envelope: d.envelope, now: T0, self: 'vm5', edge }).ledger;
  const f = collab({ kind: 'feedback', from: 'vm5', to: 'vm4', body: 'rev', now: T0 + 10, reply_to: d.envelope.id });
  led = checkReceiveBounds({ ledger: led, envelope: f.envelope, now: T0 + 10, self: 'vm4', edge }).ledger;
  const d2 = collab({ body: 'work again', now: T0 + 20 });
  const v = checkReceiveBounds({ ledger: led, envelope: d2.envelope, now: T0 + 20, self: 'vm5', edge });
  assert.equal(v.ok, true);
  assert.equal(v.round, 2, 'a second delegate opens round 2');
  assert.equal(v.ledger.chains.collab1.depth, 2);
});

check('RECEIVE refuses a depth the chain has already spent — the hole B2B-1 left', () => {
  // A sender that skips /tell can hand-build an envelope and declare depth 1
  // forever. The receiver used to trust that number; it must not.
  const edge = { ...COLLAB_EDGE, maxDepth: 2, maxTurns: 10, maxRounds: 5 };
  let led = emptyLedger();
  for (let i = 0; i < 2; i += 1) {
    const b = collab({ body: `hop ${i}`, now: T0 + i * 10 });
    const v = checkReceiveBounds({ ledger: led, envelope: b.envelope, now: T0 + i * 10, self: 'vm5', edge });
    assert.equal(v.ok, true, `hop ${i + 1} is inside the cap`);
    led = v.ledger;
  }
  // Lying about depth=1 must not buy another hop.
  const liar = collab({ body: 'liar', now: T0 + 20 });
  liar.envelope.depth = 1;
  const v = checkReceiveBounds({ ledger: led, envelope: liar.envelope, now: T0 + 20, self: 'vm5', edge });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'DEPTH_EXCEEDED');
  assert.match(v.reason, /chain has 2 hop/);
});

check('one agent agreeing with itself never converges a chain', () => {
  const edge = { ...COLLAB_EDGE, maxTurns: 10, maxRounds: 5 };
  const d = collab({ body: 'work', now: T0 });
  let led = checkReceiveBounds({ ledger: emptyLedger(), envelope: d.envelope, now: T0, self: 'vm5', edge }).ledger;
  // vm5 records the peer vm4 agreeing…
  const a = collab({ kind: 'agree', from: 'vm4', body: 'done', now: T0 + 10, reply_to: d.envelope.id });
  let v = checkReceiveBounds({ ledger: led, envelope: a.envelope, now: T0 + 10, self: 'vm5', edge });
  assert.equal(v.ok, true);
  assert.equal(v.converged, false, 'one agreement is not a consensus');
  led = v.ledger;
  // …and only converges once the seat has ALSO sent its own agree, which lands
  // in the ledger from the send side.
  led.chains.collab1.ourAgree = 1;
  const a2 = collab({ kind: 'agree', from: 'vm4', body: 'done again', now: T0 + 20, reply_to: d.envelope.id, chain: 'collab1' });
  a2.envelope.id = 'second';
  v = checkReceiveBounds({ ledger: led, envelope: a2.envelope, now: T0 + 20, self: 'vm5', edge });
  assert.equal(v.ok, true);
  assert.equal(v.converged, true, 'two halves, both seats — now it is a consensus');
  assert.deepEqual(v.agreeingSeats, ['vm4', 'vm5']);
});

check('agreement from an earlier round does not close a later one', () => {
  const edge = { ...COLLAB_EDGE, maxTurns: 10, maxRounds: 3 };
  const d = collab({ body: 'work', now: T0 });
  let led = checkReceiveBounds({ ledger: emptyLedger(), envelope: d.envelope, now: T0, self: 'vm5', edge }).ledger;
  const a = collab({ kind: 'agree', from: 'vm4', body: 'done', now: T0 + 10, reply_to: d.envelope.id });
  led = checkReceiveBounds({ ledger: led, envelope: a.envelope, now: T0 + 10, self: 'vm5', edge }).ledger;
  assert.equal(led.chains.collab1.peerAgree, 1);
  // Round 2 opens; the round-1 agreement must not carry over.
  const d2 = collab({ body: 'more work', now: T0 + 20 });
  const v = checkReceiveBounds({ ledger: led, envelope: d2.envelope, now: T0 + 20, self: 'vm5', edge });
  assert.equal(v.ok, true);
  assert.equal(v.round, 2);
  assert.equal(v.converged, false, 'stale agreement cannot close round 2');
});

check('one agree does NOT close the chain — only a converged one does', () => {
  // Regression sensor. `agree` is in TERMINAL_KINDS, so the first agreement used
  // to set terminal and the second was refused as AFTER_TERMINAL: no chain could
  // ever converge, because the two seats would have had to agree simultaneously.
  const edge = { ...COLLAB_EDGE, maxTurns: 10, maxRounds: 5 };
  const d = collab({ body: 'work', now: T0 });
  let led = checkReceiveBounds({ ledger: emptyLedger(), envelope: d.envelope, now: T0, self: 'vm5', edge }).ledger;
  const a = collab({ kind: 'agree', from: 'vm4', body: 'done', now: T0 + 10, reply_to: d.envelope.id });
  const v = checkReceiveBounds({ ledger: led, envelope: a.envelope, now: T0 + 10, self: 'vm5', edge });
  assert.equal(v.ok, true);
  assert.equal(v.ledger.chains.collab1.terminal, false, 'one arm of the pair is not a consensus');
  led = v.ledger;
  const late = collab({ kind: 'feedback', from: 'vm5', to: 'vm4', body: 'one more thought', now: T0 + 20, reply_to: a.envelope.id });
  assert.equal(checkReceiveBounds({ ledger: led, envelope: late.envelope, now: T0 + 20, self: 'vm4', edge }).ok, true);
});

check('a converged agree is terminal: nothing may follow it', () => {
  const edge = { ...COLLAB_EDGE, maxTurns: 10, maxRounds: 5 };
  const d = collab({ body: 'work', now: T0 });
  let led = checkReceiveBounds({ ledger: emptyLedger(), envelope: d.envelope, now: T0, self: 'vm5', edge }).ledger;
  const a = collab({ kind: 'agree', from: 'vm4', body: 'done', now: T0 + 10, reply_to: d.envelope.id });
  led = checkReceiveBounds({ ledger: led, envelope: a.envelope, now: T0 + 10, self: 'vm5', edge }).ledger;
  led.chains.collab1.ourAgree = 1;
  const a2 = collab({ kind: 'agree', from: 'vm4', body: 'done', now: T0 + 20, reply_to: a.envelope.id });
  a2.envelope.id = 'second-arm';
  const done = checkReceiveBounds({ ledger: led, envelope: a2.envelope, now: T0 + 20, self: 'vm5', edge });
  assert.equal(done.ok, true);
  assert.equal(done.converged, true);
  assert.equal(done.ledger.chains.collab1.terminal, true, 'now the chain is closed');
  const late = collab({ kind: 'feedback', from: 'vm5', to: 'vm4', body: 'actually, one more', now: T0 + 30, reply_to: 'second-arm' });
  const v = checkReceiveBounds({ ledger: done.ledger, envelope: late.envelope, now: T0 + 30, self: 'vm4', edge });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'AFTER_TERMINAL');
});

check('the chain id rides the wire, so a multi-round chain stays one chain', () => {
  const built = collab({ chain: 'gp-letter-round' });
  assert.ok(built.text.includes('chain=gp-letter-round'), 'the header carries it');
  const back = decodeEnvelope(built.text);
  assert.equal(chainIdOf(back.envelope), 'gp-letter-round');
  // Without it, the old reply_to rule would have keyed a fresh chain per hop.
  const legacy = encodeEnvelope({ from: 'vm4', to: 'vm5', kind: 'feedback', ref: 'gp-letter', body: 'x', now: T0 });
  assert.equal(chainIdOf(decodeEnvelope(legacy.text).envelope), legacy.envelope.id, 'legacy envelopes still work');
});

check('the reply_to duplicate rule does not strangle a collaboration', () => {
  // Every reply in a negotiation quotes the last message, so under the old rule
  // the second reply would have been refused as a duplicate claimant.
  const edge = { ...COLLAB_EDGE, maxTurns: 10, maxRounds: 3 };
  const d = collab({ body: 'work', now: T0 });
  let led = checkReceiveBounds({ ledger: emptyLedger(), envelope: d.envelope, now: T0, self: 'vm5', edge }).ledger;
  const f1 = collab({ kind: 'feedback', from: 'vm5', to: 'vm4', body: 'rev one', now: T0 + 10, reply_to: d.envelope.id });
  led = checkReceiveBounds({ ledger: led, envelope: f1.envelope, now: T0 + 10, self: 'vm4', edge }).ledger;
  const f2 = collab({ kind: 'feedback', body: 'rev two', now: T0 + 20, reply_to: f1.envelope.id });
  const v = checkReceiveBounds({ ledger: led, envelope: f2.envelope, now: T0 + 20, self: 'vm5', edge });
  assert.equal(v.ok, true, 'a second reply is not a duplicate claimant');
  // But a byte-identical replay still is.
  const replay = collab({ kind: 'feedback', body: 'rev two', now: T0 + 30, reply_to: f1.envelope.id });
  replay.envelope.id = f2.envelope.id;
  const dup = checkReceiveBounds({ ledger: v.ledger, envelope: replay.envelope, now: T0 + 30, self: 'vm5', edge });
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'DUPLICATE', 'dedupe on the id still holds');
});

check('the delegation prompt says the human is not speaking', () => {
  const built = collab({ from: 'vm4', to: 'vm5', body: 'here is my draft' });
  const p = delegationPrompt(built.envelope, { self: 'vm5', round: 2, turnsLeft: 1, maxRounds: 3, source: '## GP letter\nrow' });
  assert.match(p, /NOT from the human/);
  assert.match(p, /round 2 of at most 3/);
  assert.match(p, /1 turn\(s\) remain/);
  assert.match(p, /here is my draft/);
  assert.match(p, /GP letter/, 'the material both seats review is inlined');
  assert.match(p, /Verdict: agree/);
  assert.match(p, /sent to vm4 automatically/, 'it is told the host does the sending');
});

check('agreement is read from a marker line and stripped from the letter', () => {
  const yes = readAgreement('Dear Dr Smith,\n\nthe short version.\n\nVerdict: agree');
  assert.equal(yes.agreed, true);
  assert.equal(yes.letter, 'Dear Dr Smith,\n\nthe short version.', 'the marker is not shown to the human');
  const bold = readAgreement('text\n**Verdict: agree**');
  assert.equal(bold.agreed, true, 'a bolded marker still counts');
  const no = readAgreement('I still want the second paragraph rewritten.');
  assert.equal(no.agreed, false);
  assert.equal(no.letter, 'I still want the second paragraph rewritten.', 'no marker means the letter is untouched');
  // The word "agree" in prose must not close the chain.
  const prose = readAgreement('I agree with most of this but not the tone.\n\nPlease revise.');
  assert.equal(prose.agreed, false, 'a marker must be its own line, not prose');
});

check('a send carries the chain id so the peer answers into the same chain', () => {
  const built = collab();
  const bounded = checkSendBounds({
    ledger: emptyLedger(),
    edge: { ...COLLAB_EDGE, maxRounds: 3 },
    now: T0,
    chainId: 'gp-letter-round',
    envelope: built.envelope,
  });
  assert.equal(bounded.ok, true);
  assert.equal(bounded.envelope.chain, 'gp-letter-round');
  assert.equal(bounded.ledger.chains['gp-letter-round'].round, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? 'assert-b2b-collab: PASS' : 'assert-b2b-collab: FAIL');
process.exitCode = failed === 0 ? 0 : 1;

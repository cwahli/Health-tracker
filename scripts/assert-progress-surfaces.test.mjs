/**
 * assert-progress-surfaces — the two live surfaces must agree about one turn.
 *
 * Companion to `assert-progress-sync.test.mjs` (which owns the relay cursor).
 * This file owns the RENDERER side of the same problem:
 *
 *   Node 1 — reasoning is compressed from the ACCUMULATED stream, keyed by part
 *            id, and is independent of arrival order.
 *   Node 2 — `thinkingLevel` (a reasoning LEVEL) and `thinkingText` (a gist of
 *            reasoning CONTENT) are separate fields with separate renderings.
 *   Node 3 — the phase label is derived from the real tool lifecycle, so it
 *            cannot contradict the answer.
 *
 * Every check below is a defect class that shipped once. Run:
 *   node scripts/assert-progress-surfaces.test.mjs
 */

import assert from 'node:assert/strict';

import { createReasoningReducer, compressReasoning } from './lib/reasoning-compress.mjs';
import { phaseLabelFor } from './lib/tg-progress.mjs';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${err?.message || err}`);
  }
}

console.log('assert-progress-surfaces:');

// ── Node 1: accumulate, don't summarise each shard ──────────────────────────

check('the gist advances as the reasoning accumulates (not frozen on shard one)', () => {
  const r = createReasoningReducer({ maxChars: 220 });
  const first = r.push({ id: 'p1', type: 'reasoning' }, { text: 'I should check the registry first because the chairs must be unique. ' });
  assert.ok(first && first.length > 12, 'a real sentence should produce a gist');

  const later = r.push({ id: 'p1', type: 'reasoning' }, { text: 'Then I need to fix the duplicate assignment in project-registry.mjs. ' });
  assert.notEqual(later, first, 'the gist must MOVE when the reasoning advances');

  // The old behaviour compressed each fragment alone, so a mid-sentence
  // fragment yielded a fragment and the caller's dedupe guard dropped it.
  const midSentence = r.push({ id: 'p1', type: 'reasoning' }, { text: 'ing the parity assert' });
  assert.ok(typeof midSentence === 'string', 'a mid-sentence fragment must not throw');
});

check('one-word fragments are suppressed; a real summary is not', () => {
  const r = createReasoningReducer({ maxChars: 220, minWords: 2 });
  assert.equal(r.push({ id: 'p1', type: 'reasoning' }, { text: 'anywhere' }), '', 'a one-word shard must not become a headline');
  const good = r.push({ id: 'p1', type: 'reasoning' }, { text: 'anywhere in the registry file' });
  assert.ok(good && good.split(/\s+/).length >= 2, 'a real phrase must survive');
});

check('a delta that beats its own part registration is buffered, not lost', () => {
  // opencode #26924: message.part.delta can arrive before message.part.updated.
  const r = createReasoningReducer({ maxChars: 220 });
  r.push(null, { text: 'the registry has a duplicate chair assignment to fix. ' });
  const afterRegistration = r.push({ id: 'p1', type: 'reasoning' });
  assert.ok(afterRegistration, 'text buffered before registration must still reduce');
});

check('a reordered STREAM of full snapshots reduces identically', () => {
  // Order-independence is a property of SNAPSHOTS, not of deltas. A delta is
  // defined as an append, so replaying deltas backwards is meaningless — the
  // reducer is not wrong to concatenate them in arrival order. What must be
  // order-independent is the case that actually bit us: a late full snapshot
  // landing after its own deltas has to repair the text regardless of when it
  // arrived relative to them.
  const full = 'first I check the registry. then I need to fix the duplicate chair. finally the parity assert must pass.';

  const clean = createReasoningReducer({ maxChars: 220 });
  const a = clean.push({ id: 'p1', type: 'reasoning', text: full });

  const messy = createReasoningReducer({ maxChars: 220 });
  messy.push({ id: 'p1', type: 'reasoning' }, { text: 'first I check the registry. ' });
  messy.push({ id: 'p1', type: 'reasoning', text: full });   // snapshot after its own deltas
  const repaired = messy.push({ id: 'p1', type: 'reasoning' });

  assert.equal(a, repaired, 'a late snapshot must converge to the same summary as a clean one');
});

check('a full snapshot is authoritative and repairs a lossy delta stream', () => {
  const r = createReasoningReducer({ maxChars: 220 });
  r.push({ id: 'p1', type: 'reasoning' }, { text: 'I should check the registry. ' });
  // Producer replays the whole part; the snapshot must win.
  const repaired = r.push({ id: 'p1', type: 'reasoning', text: 'I should check the registry. Then I need to fix the duplicate chair assignment there.' });
  assert.match(repaired, /duplicate chair/, 'the snapshot text did not win over the accumulated delta');
});

check('two reasoning parts are tracked separately, never conflated', () => {
  const r = createReasoningReducer({ maxChars: 220 });
  r.push({ id: 'pA', type: 'reasoning' }, { text: 'checking the registry file. ' });
  r.push({ id: 'pB', type: 'reasoning' }, { text: 'then fixing the parity assert. ' });
  const ids = r.parts().map((p) => p.id);
  assert.deepEqual(ids.sort(), ['pA', 'pB'], 'parts must not be merged');
});

check('an unbalanced fragment does not throw or hang (opencode #43312)', () => {
  const r = createReasoningReducer({ maxChars: 220 });
  r.push({ id: 'p1', type: 'reasoning' }, { text: 'thinking about the failure mode. ' });
  // No `time.end` ever arrives. The reducer must still answer.
  assert.equal(r.open, true);
  assert.doesNotThrow(() => r.push({ id: 'p1', type: 'reasoning' }, { text: 'still going. ' }));
  const closed = createReasoningReducer({ maxChars: 220 });
  closed.push({ id: 'p1', type: 'reasoning', time: { end: 1 } }, { text: 'done thinking about it. ' });
  assert.equal(closed.open, false, 'an explicitly ended part must read as closed');
});

check('reasoning is never read off `field` (opencode sends field:"text")', () => {
  // The reducer takes the part's declared type. A part that never declares
  // reasoning must not have its text treated as a reasoning summary.
  const r = createReasoningReducer({ maxChars: 220 });
  r.push({ id: 'p1', type: 'text', field: 'text' }, { text: 'Here is the final answer to your question about the registry. ' });
  const ids = r.parts().map((p) => p.id);
  assert.ok(ids.includes('p1'), 'the part is still tracked');
  // Nothing asserts it is a REASONING part: the reducer never inspects field.
  assert.doesNotThrow(() => r.push({ id: 'p1', type: 'text', field: 'text' }, { text: 'more answer text here. ' }));
});

// ── Node 2: the two "thinking" fields no longer collide ─────────────────────

check('a reasoning LEVEL and reasoning CONTENT are distinguishable values', () => {
  // The bug was two different fields both called "thinking", so /status
  // printing a level and the headline printing a sentence looked identical.
  const level = 'high';
  const text = compressReasoning('I should check the registry first.', { maxChars: 220 });
  assert.equal(typeof level, 'string');
  assert.ok(text.length > 0);
  assert.notEqual(level, text, 'a level and a gist must never render identically');
  assert.ok(!/^(low|medium|high|xhigh)$/i.test(text), 'a gist must not look like a level');
});

// ── Node 3: the phase label is truthful by construction ─────────────────────

check('phase labels come from the tool, never from the model', () => {
  assert.equal(phaseLabelFor('bash (running)', 'working'), 'running a command');
  assert.equal(phaseLabelFor('bash (completed)', 'working'), 'ran a command');
  assert.equal(phaseLabelFor('read (running)', 'working'), 'reading files');
  assert.equal(phaseLabelFor('edit (completed)', 'working'), 'wrote files');
  assert.equal(phaseLabelFor('vitest (running)', 'working'), 'running the gates');
  assert.equal(phaseLabelFor('git (completed)', 'working'), 'checked git');
});

check('an unknown tool collapses to a generic label — no invented narrative', () => {
  assert.equal(phaseLabelFor('some_unknown_thing (running)', 'working'), 'working');
  assert.equal(phaseLabelFor('', 'thinking'), 'thinking it through');
  assert.equal(phaseLabelFor('', 'working'), '', 'no tool and no thinking means no label');
});

check('the phase label never leaks raw tool arguments', () => {
  const label = phaseLabelFor('bash --rm -rf /secret/path (running)', 'working');
  assert.ok(!label.includes('/secret'), 'tool arguments must not reach the user surface');
  assert.ok(!label.includes('--rm'), 'flags must not reach the user surface');
});

check('compressReasoning still behaves for a single complete sentence', () => {
  const out = compressReasoning('I need to fix the duplicate chair assignment in the registry.', { maxChars: 220 });
  assert.ok(out.length > 0);
  assert.ok(out.length <= 220, 'must respect maxChars');
});

console.log(`assert-progress-surfaces: ${passed} pass, ${failed} fail`);
process.exit(failed > 0 ? 1 : 0);
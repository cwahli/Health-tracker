/**
 * assert-progress-sync — the two live surfaces must agree about one turn.
 *
 * WHY THIS EXISTS
 * ---------------
 * A turn's events fan out to two recorders: the Telegram headline and the tmux
 * observer pane. They used to diverge silently because the relay cursor was an
 * **index into an array that was trimmed from the front**. Past the 500-event
 * cap, the reader's `after` silently began pointing at a different event, so
 * events were duplicated or skipped and nobody was told. Timestamps had the
 * same problem in a different costume: the receiver's clock overwrote the
 * producer's, so the two surfaces could disagree about what happened first.
 *
 * This file is the ratchet. Every claim below is a defect class that shipped
 * once already. If a future change breaks one, this goes red.
 *
 * Run: node scripts/assert-progress-sync.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MAX_JOB_EVENTS,
  appendJobEvent,
  enqueueJob,
  readJobEvents,
} from './lib/worker-jobs.mjs';
import { formatObserverRecord } from './lib/work-session.mjs';

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

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-sync-'));
process.on('exit', () => {
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
});

/**
 * A job the relay will accept events for.
 *
 * The file NAME is the lookup key (`jobPath` derives it from the id), so the
 * helper has to write the row under the id's own filename rather than renaming
 * the id inside some other file. Getting this wrong fails every case at once,
 * which is what the first run of this sensor did.
 */
function openJob(id = 'job_progress_sync') {
  enqueueJob({ host: 'vm', prompt: 'p', model: 'm', workspace: 'w' }, { home });
  const dir = path.join(home, '.hermes', 'worker-jobs');
  const minted = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const source = path.join(dir, minted[minted.length - 1]);
  const row = JSON.parse(fs.readFileSync(source, 'utf8'));
  row.id = id;
  row.events = [];
  delete row.lastEventSeq;
  delete row.droppedThrough;
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`);
  fs.rmSync(source, { force: true });
  return { id, file };
}

console.log('assert-progress-sync:');

check('every appended event gets a strictly monotonic seq', () => {
  const job = openJob('job_monotonic');
  const seen = [];
  for (let i = 0; i < 25; i += 1) {
    const out = appendJobEvent(job.id, { kind: 'tool', tool: `t${i}`, status: 'ok' }, { home });
    assert.equal(out.ok, true, `append ${i} refused`);
    seen.push(out.seq);
  }
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] > seen[i - 1], `seq went backwards at ${i}: ${seen[i - 1]} -> ${seen[i]}`);
  }
  assert.equal(seen[0], 1, 'first seq should be 1');
  assert.equal(new Set(seen).size, seen.length, 'seq must be unique');
});

check('a reader resuming from `after` sees no gap and no duplicate', () => {
  const job = openJob('job_resume');
  for (let i = 0; i < 40; i += 1) {
    appendJobEvent(job.id, { kind: 'text', text: `chunk-${i}` }, { home });
  }
  // Read a prefix, then resume exactly where it stopped.
  const first = readJobEvents(job.id, { after: 0, home });
  assert.equal(first.events.length, 40, 'first read should return everything');
  const cursor = first.nextAfter;

  for (let i = 40; i < 55; i += 1) {
    appendJobEvent(job.id, { kind: 'text', text: `chunk-${i}` }, { home });
  }
  const second = readJobEvents(job.id, { after: cursor, home });
  assert.equal(second.events.length, 15, `resumed read should return 15, got ${second.events.length}`);
  assert.equal(second.events[0].text, 'chunk-40', 'resume landed on the wrong event');
  const texts = second.events.map((e) => e.text);
  assert.equal(new Set(texts).size, texts.length, 'resumed read duplicated an event');
});

check('crossing the retention cap loses nothing a reader can act on', () => {
  const job = openJob('job_overflow');
  const total = MAX_JOB_EVENTS + 120;
  for (let i = 0; i < total; i += 1) {
    appendJobEvent(job.id, { kind: 'text', text: `ov-${i}` }, { home });
  }
  // A reader that never polled is behind the trim point. It must be told.
  const stale = readJobEvents(job.id, { after: 0, home });
  assert.equal(stale.resyncRequired, true, 'overflow must raise resyncRequired, not hide the gap');
  assert.ok(stale.droppedThrough > 0, 'droppedThrough must name the trim point');

  // Everything still retained is sequenced and strictly increasing.
  const seqs = stale.events.map((e) => Number(e.seq));
  for (let i = 1; i < seqs.length; i += 1) {
    assert.ok(seqs[i] > seqs[i - 1], `retained window is not ordered at ${i}`);
  }
  assert.equal(seqs[seqs.length - 1], total, 'newest retained seq should be the last appended');
});

check('a reader already caught up past the trim point is NOT told to resync', () => {
  const job = openJob('job_caughtup');
  const total = MAX_JOB_EVENTS + 60;
  for (let i = 0; i < total; i += 1) {
    appendJobEvent(job.id, { kind: 'text', text: `cu-${i}` }, { home });
  }
  // Poll late enough that the cursor sits inside the retained window.
  const near = readJobEvents(job.id, { after: total - 5, home });
  assert.equal(near.resyncRequired, false, 'no gap here — resyncRequired would be a false alarm');
  assert.equal(near.events.length, 5);
  assert.equal(near.events[0].text, `cu-${total - 5}`);
});

check('the producer timestamp survives the relay; the receiver clock is kept beside it', () => {
  const job = openJob('job_clock');
  // A producer on a box whose clock runs 2h fast.
  const producerStamp = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  appendJobEvent(job.id, { kind: 'text', text: 'skewed', at: producerStamp }, { home });
  const read = readJobEvents(job.id, { after: 0, home });
  const ev = read.events.at(-1);
  assert.equal(ev.at, producerStamp, 'producer clock was overwritten by the receiver');
  assert.equal(ev.producerAt, true);
  assert.ok(ev.receivedAt, 'receiver clock must still be recorded, for latency');
  assert.notEqual(ev.at, ev.receivedAt, 'the two clocks should genuinely differ in this test');
});

check('an event with no usable producer timestamp falls back to the local clock', () => {
  const job = openJob('job_noclock');
  appendJobEvent(job.id, { kind: 'text', text: 'x', at: 'not-a-date' }, { home });
  const ev = readJobEvents(job.id, { after: 0, home }).events.at(-1);
  assert.ok(!Number.isNaN(Date.parse(ev.at)), 'at must always be a real timestamp');
  assert.equal(ev.producerAt, undefined, 'an invented timestamp must not claim producer provenance');
});

check('the observer pane records the same producer ordering, not its own arrival order', () => {
  const a = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const b = new Date(Date.now() + 61 * 60 * 1000).toISOString();
  const first = formatObserverRecord('event', { kind: 'text', text: 'one', at: a, seq: 7 }, {}, new Date().toISOString());
  const second = formatObserverRecord('event', { kind: 'text', text: 'two', at: b, seq: 8 }, {}, new Date().toISOString());
  assert.equal(first.at, a, 'observer overwrote the producer clock');
  assert.equal(second.at, b);
  assert.ok(Date.parse(first.at) < Date.parse(second.at), 'ordering must come from the producer');
  assert.equal(first.seq, 7, 'seq must cross to the pane so a relayed event can be matched');
  assert.ok(first.receivedAt, 'arrival time is still recorded separately');
});

check('an unsequenced legacy backlog still reads (no silent skip)', () => {
  const job = openJob('job_legacy');
  appendJobEvent(job.id, { kind: 'text', text: 'seed' }, { home });
  // Simulate a job file written before this change: index-addressed, no seq.
  const row = JSON.parse(fs.readFileSync(job.file, 'utf8'));
  row.events = [{ kind: 'text', at: new Date().toISOString(), text: 'legacy-1' }, { kind: 'text', at: new Date().toISOString(), text: 'legacy-2' }];
  delete row.lastEventSeq;
  delete row.droppedThrough;
  fs.writeFileSync(job.file, `${JSON.stringify(row, null, 2)}\n`);
  const read = readJobEvents(job.id, { after: 0, home });
  assert.equal(read.unsequenced, true, 'legacy backlog must be flagged, not silently re-sequenced');
  assert.equal(read.events.length, 2, 'legacy events must still be delivered');
  assert.equal(read.events[0].text, 'legacy-1');
});

console.log(`assert-progress-sync: ${passed} pass, ${failed} fail`);
process.exit(failed > 0 ? 1 : 0);
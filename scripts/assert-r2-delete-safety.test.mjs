#!/usr/bin/env node
// Sensor: D-10 delete safety. The sweep script may only delete orphans under
// photos/ (or named retention prefixes), never golden/, never tier3, never
// missing keys, never anything fresh. Run: node scripts/assert-r2-delete-safety.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeletablePhotoKey, retentionPrefixes, pastGrace, partitionTier2Group } from './r2-orphan-sweep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, 'r2-orphan-sweep.mjs'), 'utf8');

describe('delete guards are structural, not comments', () => {
  it('every delete path filters through the photos/ guard', () => {
    const deleteSites = [...SRC.matchAll(/DeleteObjectCommand\(\{ Bucket, Key: ([^ }]+) \}\)/g)].map((m) => m[1]);
    assert.ok(deleteSites.length >= 2, `expected delete call sites, got ${deleteSites.length}`);
    assert.ok(SRC.includes('isDeletablePhotoKey'), 'guard helper must be referenced');
    // tier1 + tier2 paths both consult it (static tripwire against a new unguarded caller).
    assert.equal((SRC.match(/isDeletablePhotoKey\(/g) || []).length >= 2, true);
  });
  it('tier3 and missing keys never reach a delete call', () => {
    const run = SRC.slice(SRC.indexOf('async function deleteRun'), SRC.indexOf('async function retentionRun'));
    assert.ok(!run.includes('tier3'), 'delete run must not mention tier3');
    assert.ok(!run.includes('missing'), 'delete run must not touch missing keys');
    assert.ok(SRC.includes('missing keys are NEVER deleted'), 'missing-key refusal must stay');
  });
  it('no --execute means no delete (dry run is the default)', () => {
    assert.ok(SRC.includes("console.log('dry run — pass --execute to delete. Nothing was deleted.')"));
    assert.ok(SRC.includes("const execute = argv.includes('--execute')"));
  });
  it('runtime re-verify: fresh referenced set is read inside the delete run', () => {
    const run = SRC.slice(SRC.indexOf('async function deleteRun'), SRC.indexOf('async function retentionRun'));
    assert.ok(run.includes('await referencedPhotoKeys()'), 'delete run must re-read references, not trust the manifest');
  });
  it('delete output never overwrites its input manifest', () => {
    const run = SRC.slice(SRC.indexOf('async function deleteRun'), SRC.indexOf('async function retentionRun'));
    assert.ok(run.includes('has no tier1/tier2 arrays'), 'unshaped manifest must fail loudly, not plan nothing');
    assert.ok(!run.includes('writeFileSync(manifestPath'), 'input manifest path must never be the write target');
  });
});

describe('isDeletablePhotoKey', () => {
  it('allows photos/, refuses everything else', () => {
    assert.equal(isDeletablePhotoKey('photos/a.jpg'), true);
    assert.equal(isDeletablePhotoKey('photos/golden/x.jpg'), false);
    assert.equal(isDeletablePhotoKey('debug/a.json'), false);
    assert.equal(isDeletablePhotoKey('golden/a.jpg'), false);
    assert.equal(isDeletablePhotoKey(''), false);
    assert.equal(isDeletablePhotoKey(null), false);
    assert.equal(isDeletablePhotoKey('xphotos/a.jpg'), false);
  });
});

describe('retentionPrefixes', () => {
  it('excludes bugs/ unless explicitly included', () => {
    assert.deepEqual(retentionPrefixes(false), ['debug/', 'logs/', 'jobs/']);
    assert.deepEqual(retentionPrefixes(true), ['debug/', 'logs/', 'jobs/', 'bugs/']);
  });
});

describe('pastGrace', () => {
  it('skips fresh and timestamp-less objects', () => {
    const now = Date.now();
    assert.equal(pastGrace(new Date(now - 31 * 864e5).toISOString(), now), true);
    assert.equal(pastGrace(new Date(now - 29 * 864e5).toISOString(), now), false);
    assert.equal(pastGrace(null, now), false);
    assert.equal(pastGrace('not-a-date', now), false);
  });
});

describe('partitionTier2Group', () => {
  const group = { keep: { key: 'photos/keep.jpg' }, delete: ['photos/d1.jpg', 'photos/d2.jpg'] };
  it('deletes when keep exists and members unreferenced', () => {
    const r = partitionTier2Group(group, new Set(['photos/keep.jpg']), new Set());
    assert.deepEqual(r.deletes, ['photos/d1.jpg', 'photos/d2.jpg']);
  });
  it('holds when keep is missing and a member is referenced', () => {
    const r = partitionTier2Group(group, new Set(), new Set(['photos/d1.jpg']));
    assert.deepEqual(r.deletes, []);
  });
  it('deletes all-unreferenced even when keep is gone', () => {
    const r = partitionTier2Group(group, new Set(), new Set());
    assert.deepEqual(r.deletes, ['photos/d1.jpg', 'photos/d2.jpg']);
  });
  it('never deletes a referenced member', () => {
    const r = partitionTier2Group(group, new Set(['photos/keep.jpg']), new Set(['photos/d2.jpg']));
    assert.deepEqual(r.deletes, ['photos/d1.jpg']);
  });
});
